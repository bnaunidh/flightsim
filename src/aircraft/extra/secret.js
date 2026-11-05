/**
 * The secret planes: aeroplanes you cannot pick in the Hangar until you have
 * found them (or, for Air Force One, earned it).
 *
 * The owner: "even some secret planes you cant select unless you fin them",
 * and later "add the secret planes in hangars thing if u explore yk". Where
 * they are hidden, and what finding one does, is ../../features/secrets.js;
 * this file only says what they ARE.
 *
 * EVERY ONE IS A VERSION OF AN AEROPLANE THE GAME ALREADY FLIES — a stripped
 * racer, a prototype in test paint, a storm chaser — not a new airframe, so
 * each is exactly as well drawn, seated, sounded and tested as the one it
 * comes from. `variantOf` says which: the model factory draws the base type
 * in this one's paint (model-adapter.js), and the few places that key a
 * behaviour on a type id (the airliners' take-off flap, an escape profile)
 * read through it. The flight model reads this entry's own `shape` and
 * `aero`, which start as the base's and change only where a line below says.
 *
 * `secret` is what the Hangar shows before you have it:
 *   { how: 'found' }                    hidden in a hangar on some map
 *   { how: 'earned', mission, score }   a score on a mission (Air Force One)
 * and nothing in progression.js sells one: an unfound secret is not "not in
 * the shop yet", it is a silhouette with a hint (features/secrets/menu.js).
 *
 * Original designs and paint only, school-safe.
 */

/** Ids, in the order the Hangar lists them. */
export const SECRET_IDS = ['speedster', 'stormpetrel', 'x1', 'seaghost', 'af1'];

/** A copy of `b` with `over` on top; shape and aero merged one level deep. */
function variant(b, over) {
  const out = { ...b, ...over, variantOf: b.id };
  out.shape = over.shape ? { ...b.shape, ...over.shape } : b.shape;
  out.aero = over.aero ? { ...b.aero, ...over.aero } : b.aero;
  // A variant is never something the airport parks or the shop sells.
  delete out.buildModel;
  return out;
}

export function TYPES(base) {
  const find = (id) => {
    const list = (base && base.roster) || [];
    return list.find((t) => t && t.id === id) || null;
  };
  const out = [];
  const add = (id, make) => {
    const b = find(id);
    if (b) out.push(make(b));
  };

  /*
   * The Skylark Speedster — the stripped racer. Interior out, a bigger
   * engine in, wheel spats on: lighter by an eighth and a third more power,
   * so it climbs like a much bigger aeroplane and still lands like a Skylark.
   */
  add('skylark', (b) => variant(b, {
    id: 'speedster',
    name: 'Skylark Speedster',
    class: 'Racer',
    category: 'special',
    blurb:
      'Somebody took a Skylark, threw out everything that was not needed to go fast and put in a much bigger ' +
      'engine. It climbs like a rocket and still lands like a Skylark — gently.',
    stats: { speed: 3, handling: 4, ease: 4 },
    livery: '#c62a2f',
    accent: '#f4f1e8',
    callsign: 'Speedster one',
    secret: { how: 'found' },
    aero: { mass: b.aero.mass * 0.875, thrustMax: b.aero.thrustMax * 1.35 },
  }));

  /*
   * The Storm Petrel — the tornado-resistant one (the owner, R047: "resistant
   * … but gets thrown around if close"). A Kestrel Courier with a storm-
   * chaser's spar: `stormProof` is the same switch the Tempest WR-4 carries
   * (main.js: the airframe does not fail from tornado loads, and gets thrown
   * about harder for being light). It is still flown by the wind.
   */
  add('courier', (b) => variant(b, {
    id: 'stormpetrel',
    name: 'Storm Petrel',
    class: 'Tourer',
    category: 'special',
    blurb:
      'A storm chaser’s Courier with a reinforced spar. Tornadoes and wild weather cannot break it — but it is ' +
      'small and light, so near the funnel it is thrown about like a leaf. Survivable, not comfortable.',
    stats: { speed: 2, handling: 2, ease: 3 },
    livery: '#f2c53d',
    accent: '#1f252b',
    callsign: 'Petrel one',
    stormProof: true,
    secret: { how: 'found' },
  }));

  /*
   * The Vanguard X-1 — the prototype, in white test paint with orange
   * bands, a tenth more thrust than the one in the shop. Not a military
   * aeroplane (no passcode): the Vanguard is not one either.
   */
  add('vanguard', (b) => variant(b, {
    id: 'x1',
    name: 'Vanguard X-1',
    class: 'Prototype',
    category: 'special',
    blurb:
      'The prototype the Vanguard was built from, still in its test paint. A little more thrust than the ' +
      'one you can buy, and the same lack of forgiveness. Somebody hid it rather than scrap it.',
    stats: { speed: 5, handling: 3, ease: 1 },
    livery: '#f1f1ec',
    accent: '#ff6a13',
    callsign: 'Experimental one',
    secret: { how: 'found' },
    aero: { thrustMax: b.aero.thrustMax * 1.1 },
  }));

  /*
   * The Osprey Sea Ghost — the carrier aeroplane in a night-ops grey, kept
   * below the carrier's deck. Same hook, same wings, same manners.
   */
  add('osprey', (b) => variant(b, {
    id: 'seaghost',
    name: 'Osprey Sea Ghost',
    class: 'Carrier',
    category: 'special',
    blurb:
      'An Osprey in a dark night-operations grey that the carrier crew keep below the deck. It flies exactly ' +
      'like an Osprey — hook and all — and looks like a shadow doing it.',
    stats: b.stats,
    livery: '#3b434d',
    accent: '#9fe3ff',
    callsign: 'Ghost one',
    secret: { how: 'found' },
  }));

  /*
   * Air Force One (af1.md item 7, R105): the VC-25-style 747 from the two
   * Air Force One missions, in its own scheme, unlocked for good by 80 or
   * more on "Air Force One — Under Attack" in any seat. `houseScheme` names
   * the livery it wears in its house colours (aircraft/liveries.js 'potus').
   */
  add('b747', (b) => variant(b, {
    id: 'af1',
    name: 'Air Force One',
    class: 'Airliner',
    category: 'special',
    blurb:
      'The President’s jumbo, white over light blue. The same aeroplane you escorted and defended in the Air ' +
      'Force One missions — yours to fly anywhere, for scoring 80 or more on Under Attack.',
    callsign: 'Air Force One',
    livery: '#f4f3ee',
    accent: '#7fa9d6',
    houseScheme: 'potus',
    secret: { how: 'earned', mission: 'afo-attack', score: 80, hint: 'Score 80+ on Air Force One — Under Attack to unlock' },
  }));

  return out;
}

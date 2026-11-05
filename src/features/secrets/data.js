/**
 * Where the secret planes are hidden: one or two hiding places on every map.
 *
 * PURE DATA, by named landmark, not by coordinate — with the realistic-maps
 * job in mind: when a map is redrawn, a hiding place "in the hills behind
 * the field" or "beside the strip on Mango Cay" follows the hills and the
 * strip. Each one names
 *
 *   near     a landmark of its own map: { pad: id } (a helipad), { island:
 *            name }, { outpost: true } (the delivery strip), { town: true },
 *            { lighthouse: true }, { runway: 'east' | 'west' } (an end of the
 *            main runway), { carrier: true } (the ship's deck)
 *   bearing, dist   where to start looking from it (compass degrees, metres)
 *   kind     shed | cave | bunker | far (the hangar at the far end of an
 *            airfield) | hatch (a lift in the carrier's deck)
 *   plane    which secret plane is inside (aircraft/extra/secret.js)
 *   clue     light | tracks | windsock — the one thing outside that gives it away
 *   place    how the hints and the Hangar's "Found at …" name the spot
 *
 * and ./sites.js finds the actual level, clear, dry ground for it each time
 * the world is built (tests/features/secrets.mjs builds every map and holds
 * every one of these to finding a site within its search radius).
 */

/** What each kind of hiding place is called on the prompt and in the words. */
export const KIND_WORDS = {
  shed: { noun: 'shed', open: 'Open the shed', close: 'Close the shed', door: 'shed door' },
  cave: { noun: 'cave hangar', open: 'Open the cave doors', close: 'Close the cave doors', door: 'cave doors' },
  bunker: { noun: 'bunker', open: 'Open the bunker', close: 'Close the bunker', door: 'blast door' },
  far: { noun: 'hangar', open: 'Open the hangar', close: 'Close the hangar', door: 'hangar door' },
  hatch: { noun: 'deck hatch', open: 'Open the hatch', close: 'Close the hatch', door: 'hatch' },
};

/** The first hint: a rumour about the place. */
export const KIND_RUMOUR = {
  shed: (place) => `Rumour has it a farmer near ${place} keeps something fast in a locked shed.`,
  cave: (place) => `Pilots talk about doors in the rock near ${place}.`,
  bunker: (place) => `There is an old bunker near ${place} that nobody has opened in years.`,
  far: (place) => `The last hangar at ${place} is always shut. Nobody says why.`,
  hatch: () => 'The carrier crew never talk about the hatch in the deck beside the island.',
};

/** The second hint: the clue outside. */
export const CLUE_WORDS = {
  light: 'Look for a faint light under a door — easiest to see at dusk.',
  tracks: 'Look for tyre tracks in the grass that lead nowhere.',
  windsock: 'Look for a windsock where there is no airfield.',
};

export const SPOTS = [
  // ---- Kestrel Island: where everyone learns, so the easiest two.
  { id: 'kestrel-shed', map: 'kestrel', kind: 'shed', plane: 'speedster', near: { outpost: true }, bearing: 0, dist: 120, clue: 'windsock', place: 'the strip on Mango Cay', at: [6200, -5306, 180] },
  { id: 'kestrel-cave', map: 'kestrel', kind: 'cave', plane: 'stormpetrel', near: { island: 'North Kestrel Hills' }, bearing: 160, dist: 420, clue: 'light', place: 'the North Kestrel Hills', at: [-1029, -875, 180] },
  // ---- Harrier Flats
  { id: 'meadow-shed', map: 'meadow', kind: 'shed', plane: 'speedster', near: { outpost: true }, bearing: 0, dist: 140, clue: 'tracks', place: 'Willow Bank Strip', at: [-5100, 3304, 180] },
  { id: 'meadow-bunker', map: 'meadow', kind: 'bunker', plane: 'x1', near: { town: true }, bearing: 300, dist: 1500, clue: 'light', place: 'the flats north-west of the town', at: [-23, 401, 180] },
  // ---- Coral Atoll
  { id: 'atoll-shed', map: 'atoll', kind: 'shed', plane: 'speedster', near: { outpost: true }, bearing: 0, dist: 120, clue: 'windsock', place: 'Turtle Cay Strip', at: [4600, 2480, 180] },
  { id: 'atoll-hatch', map: 'atoll', kind: 'hatch', plane: 'seaghost', near: { carrier: true }, clue: 'light', place: 'the carrier' },
  // ---- Aurora Fjords
  { id: 'fjord-cave', map: 'fjord', kind: 'cave', plane: 'stormpetrel', near: { island: 'Aurora Shelf' }, bearing: 20, dist: 900, clue: 'light', place: 'the foot of the North Wall', at: [503, -956, 180] },
  // ---- Ember Isle
  { id: 'ember-cave', map: 'ember', kind: 'cave', plane: 'stormpetrel', near: { outpost: true }, bearing: 90, dist: 300, clue: 'tracks', place: 'Cinder Cone', at: [-3888, 2956, 0] },
  // ---- Ironhead Air Base: the far hangar, and the carrier's hatch.
  { id: 'airbase-far', map: 'airbase', kind: 'far', plane: 'x1', near: { runway: 'east' }, bearing: 180, dist: 330, clue: 'light', place: 'the east end of the air base', at: [1640, 404, 90] },
  { id: 'airbase-hatch', map: 'airbase', kind: 'hatch', plane: 'seaghost', near: { carrier: true }, clue: 'light', place: 'the carrier' },
  // ---- Gateway International
  { id: 'gateway-shed', map: 'gateway', kind: 'shed', plane: 'speedster', near: { island: 'Gateway Island' }, bearing: 200, dist: 2200, clue: 'tracks', place: 'the farms south of the airport', at: [-788, 2344, 0] },
  { id: 'gateway-bunker', map: 'gateway', kind: 'bunker', plane: 'x1', near: { pad: 'downs' }, bearing: 90, dist: 500, clue: 'windsock', place: 'the Downs Beacon', at: [-980, 2737, 270] },
  // ---- Northwatch Air Station
  { id: 'northwatch-hatch', map: 'northwatch', kind: 'hatch', plane: 'seaghost', near: { carrier: true }, clue: 'light', place: 'the carrier' },
  { id: 'northwatch-bunker', map: 'northwatch', kind: 'bunker', plane: 'x1', near: { island: 'Watch Hill' }, bearing: 90, dist: 700, clue: 'light', place: 'Watch Hill', at: [-1971, 2534, 0] },
  // ---- Condor Rock
  { id: 'condor-bunker', map: 'condor', kind: 'bunker', plane: 'x1', near: { island: 'Lowtown' }, bearing: 0, dist: 300, clue: 'light', place: 'the hill above Lowtown', at: [-388, 1159, 180] },
  // ---- the boat maps
  { id: 'sennen-shed', map: 'sennen', kind: 'shed', plane: 'speedster', near: { outpost: true }, bearing: 0, dist: 140, clue: 'windsock', place: 'the strip on Wester Isle', at: [-5669, 2003, 270] },
  { id: 'skerries-cave', map: 'skerries', kind: 'cave', plane: 'stormpetrel', near: { island: 'Skerry Head' }, bearing: 90, dist: 300, clue: 'light', place: 'Skerry Head', at: [-1283, -1555, 90] },
  { id: 'longbank-shed', map: 'longbank', kind: 'shed', plane: 'speedster', near: { island: 'The Ness' }, bearing: 270, dist: 900, clue: 'tracks', place: 'The Ness', at: [-1230, -4800, 90] },
  { id: 'archipelago-shed', map: 'archipelago', kind: 'shed', plane: 'speedster', near: { island: 'Gatekeeper Cay' }, bearing: 90, dist: 700, clue: 'windsock', place: 'Gatekeeper Cay', at: [686, 83, 270] },
  { id: 'delta-shed', map: 'delta', kind: 'shed', plane: 'speedster', near: { outpost: true }, bearing: 0, dist: 140, clue: 'tracks', place: 'Tern Island', at: [1500, -5882, 270] },
  { id: 'harbour-bunker', map: 'harbour', kind: 'bunker', plane: 'x1', near: { island: 'Gannet Head' }, bearing: 270, dist: 900, clue: 'windsock', place: 'the hills of Gannet Head', at: [-382, 14, 90] },
  { id: 'lagoon-shed', map: 'lagoon', kind: 'shed', plane: 'speedster', near: { island: 'Lagoon Isle' }, bearing: 250, dist: 600, clue: 'windsock', place: 'Lagoon Isle', at: [-564, 205, 90] },
  { id: 'stormcoast-cave', map: 'stormcoast', kind: 'cave', plane: 'stormpetrel', near: { island: 'Squall Head' }, bearing: 0, dist: 700, clue: 'light', place: 'the hills of Squall Head', at: [-1705, 526, 180] },
  // ---- the car maps: a garage at the end of a track.
  { id: 'drovers-shed', map: 'drovers', kind: 'shed', plane: 'speedster', near: { outpost: true }, bearing: 180, dist: 260, clue: 'tracks', place: 'the farm by the depot', at: [1221, -430, 0] },
  { id: 'cape-cave', map: 'cape', kind: 'cave', plane: 'stormpetrel', near: { island: 'The Spine' }, bearing: 0, dist: 300, clue: 'light', place: 'The Spine', at: [510, -463, 270] },
  { id: 'cullen-bunker', map: 'cullen', kind: 'bunker', plane: 'x1', near: { island: 'Sker Holm' }, bearing: 270, dist: 300, clue: 'light', place: 'Sker Holm', at: [2031, -448, 90] },
  { id: 'town-shed', map: 'town', kind: 'shed', plane: 'speedster', near: { town: true }, bearing: 200, dist: 700, clue: 'tracks', place: 'the edge of Fenwick', at: [-82, 1443, 0] },
  { id: 'coastroad-shed', map: 'coastroad', kind: 'shed', plane: 'speedster', near: { outpost: true }, bearing: 180, dist: 300, clue: 'windsock', place: 'the end of the coast road', at: [72, 3053, 0] },
  { id: 'mountainpass-cave', map: 'mountainpass', kind: 'cave', plane: 'stormpetrel', near: { island: 'Saddleback Ridge' }, bearing: 250, dist: 900, clue: 'light', place: 'Saddleback Ridge', at: [4079, 2481, 270] },
  // ---- the helicopter maps
  { id: 'kestrel-port-shed', map: 'kestrel-port', kind: 'shed', plane: 'speedster', near: { island: 'South Kestrel Hills' }, bearing: 300, dist: 450, clue: 'windsock', place: 'the South Kestrel Hills', at: [878, 1122, 0] },
  { id: 'stacks-bunker', map: 'stacks', kind: 'bunker', plane: 'x1', near: { island: 'Flat Rock' }, bearing: 90, dist: 250, clue: 'light', place: 'Flat Rock', at: [250, -238, 0] },
  { id: 'rigs-bunker', map: 'rigs', kind: 'bunker', plane: 'x1', near: { island: 'Ironhead Head' }, bearing: 200, dist: 500, clue: 'light', place: 'Ironhead Head', at: [-171, 470, 0] },
  { id: 'carriergroup-hatch', map: 'carriergroup', kind: 'hatch', plane: 'seaghost', near: { carrier: true }, clue: 'light', place: 'the carrier' },
  { id: 'carriergroup-bunker', map: 'carriergroup', kind: 'bunker', plane: 'x1', near: { island: 'Task Force Base' }, bearing: 90, dist: 600, clue: 'windsock', place: 'Task Force Base', at: [488, 7, 270] },
  { id: 'firewatch-cave', map: 'firewatch', kind: 'cave', plane: 'stormpetrel', near: { pad: 'field' }, bearing: 20, dist: 900, clue: 'light', place: 'the foot of Long Scarp', at: [739, -1982, 180] },
  { id: 'ravencrag-cave', map: 'ravencrag', kind: 'cave', plane: 'stormpetrel', near: { island: 'Corrie Floor' }, bearing: 270, dist: 700, clue: 'light', place: 'the foot of Scarp West', at: [-290, -5380, 90] },
  // ---- Nunatak Reach: the lake shore, well away from the Site.
  { id: 'nunatak-shed', map: 'nunatak', kind: 'shed', plane: 'speedster', near: { pad: 'lake' }, bearing: 90, dist: 220, clue: 'tracks', place: 'Lake Shore', at: [-1110, 2236, 270] },
  { id: 'meridian-bunker', map: 'meridian', kind: 'bunker', plane: 'x1', near: { pad: 'signal' }, bearing: 270, dist: 120, clue: 'windsock', place: 'Signal Point', at: [4292, -2183, 90] },
];

export function spotsFor(mapId) {
  return SPOTS.filter((s) => s.map === mapId);
}

export function spotById(id) {
  return SPOTS.find((s) => s.id === id) || null;
}

/** The three lines a spot's hints say, in order. */
export function hintLines(spot) {
  const rumour = (KIND_RUMOUR[spot.kind] || KIND_RUMOUR.shed)(spot.place || 'here');
  const clue = CLUE_WORDS[spot.clue] || CLUE_WORDS.light;
  return [rumour, clue, 'It is marked, roughly, on your map now.'];
}

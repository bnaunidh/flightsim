/**
 * The sticker book, and the smoke colours the stickers pay for.
 *
 * Every sticker says how to get it in one line, and the book shows that line
 * on the ones you have not got yet — a locked sticker with no clue is a
 * wall, and one with a clue is a thing to go and do.
 */

export const STICKERS = [
  { id: 'first-star', emoji: '⭐', name: 'First Star', how: 'Find a golden star' },
  { id: 'star-10', emoji: '🌟', name: 'Star Collector', how: 'Find 10 golden stars' },
  { id: 'star-map', emoji: '🏆', name: 'Star Champion', how: 'Find every star on one map' },
  { id: 'star-3maps', emoji: '🗺️', name: 'Explorer', how: 'Find stars on 3 different maps' },
  { id: 'heli-star', emoji: '🚁', name: 'Chopper Star', how: 'Find a star in the helicopter' },
  { id: 'sea-star', emoji: '⛵', name: 'Sea Star', how: 'Find a star in the boat' },
  { id: 'road-star', emoji: '🚗', name: 'Road Star', how: 'Find a star in the car' },
  { id: 'roll', emoji: '🌀', name: 'Barrel Roller', how: 'Roll a plane all the way round (hold A or D)' },
  { id: 'loop', emoji: '➰', name: 'Loop the Loop', how: 'Fly a loop: full power, then hold S' },
  { id: 'upside', emoji: '🙃', name: 'Upside Down', how: 'Fly upside down for 3 seconds' },
  { id: 'sideways', emoji: '🦋', name: 'Sideways', how: 'Fly on your side for 2 seconds' },
  { id: 'low', emoji: '🌊', name: 'Wave Skimmer', how: 'Fly really low and really fast' },
  { id: 'spin', emoji: '🌪️', name: 'Spinner', how: 'Spin the helicopter all the way round (Q or E)' },
  { id: 'donut', emoji: '🍩', name: 'Donut Maker', how: 'Turn the car or boat in a full circle' },
  { id: 'air', emoji: '🦘', name: 'Big Air', how: 'Make the car jump' },
  { id: 'combo', emoji: '👑', name: 'Combo King', how: 'Do 3 stunts in a row, quickly' },
  { id: 'stunt-1000', emoji: '🎪', name: 'Stunt Star', how: 'Score 1,000 stunt points in one go' },
  { id: 'smoke', emoji: '💨', name: 'Smoke Show', how: 'Turn on a smoke trail (T, or the 💨 button)' },
  { id: 'firefighter', emoji: '🚒', name: 'Firefighter', how: 'Put out a wildfire with water' },
  { id: 'storm', emoji: '⛈️', name: 'Storm Chaser', how: 'Keep flying through a disaster for 30 seconds' },
  { id: 'night', emoji: '🦉', name: 'Night Owl', how: 'Fly, sail or drive at night' },
];

export function findSticker(id) {
  return STICKERS.find((s) => s.id === id) || null;
}

export function stickerCount(data) {
  return STICKERS.filter((s) => data.stickers[s.id]).length;
}

/**
 * Smoke colours, cheapest first. `need` is a number of stickers, or the id
 * of one sticker (gold is for finding every star on a map).
 */
export const SMOKE_COLOURS = [
  { id: 'white', name: 'Cloud White', rgb: [0.96, 0.96, 0.98], need: 0 },
  { id: 'red', name: 'Rocket Red', rgb: [1.0, 0.24, 0.2], need: 1 },
  { id: 'blue', name: 'Sky Blue', rgb: [0.25, 0.55, 1.0], need: 3 },
  { id: 'green', name: 'Frog Green', rgb: [0.3, 0.9, 0.35], need: 5 },
  { id: 'pink', name: 'Bubblegum', rgb: [1.0, 0.45, 0.8], need: 8 },
  { id: 'gold', name: 'Gold Star', rgb: [1.0, 0.8, 0.2], need: 'star-map' },
  { id: 'rainbow', name: 'Rainbow', rgb: null, need: 12 },
];

export function colourUnlocked(data, c) {
  if (typeof c.need === 'string') return !!data.stickers[c.need];
  return stickerCount(data) >= c.need;
}

/** One line: what unlocks this colour. */
export function colourNeeds(c) {
  if (typeof c.need === 'string') {
    const s = findSticker(c.need);
    return s ? `Get the ${s.name} sticker` : 'Locked';
  }
  return c.need === 0 ? 'Free' : `${c.need} sticker${c.need === 1 ? '' : 's'}`;
}

/** The colour to fly with: the chosen one if it is unlocked, else white. */
export function activeColour(data) {
  const c = SMOKE_COLOURS.find((k) => k.id === (data.smoke && data.smoke.color));
  return c && colourUnlocked(data, c) ? c : SMOKE_COLOURS[0];
}

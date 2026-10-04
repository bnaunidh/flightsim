/**
 * The smoke trail's colours.
 *
 * Used to be unlocked by the sticker book (see git history): now that the
 * sticker book is gone, every colour — Rainbow included — is available from
 * the start. Fewer locks, not a new feature.
 */

export const SMOKE_COLOURS = [
  { id: 'white', name: 'Cloud White', rgb: [0.96, 0.96, 0.98] },
  { id: 'red', name: 'Rocket Red', rgb: [1.0, 0.24, 0.2] },
  { id: 'blue', name: 'Sky Blue', rgb: [0.25, 0.55, 1.0] },
  { id: 'green', name: 'Frog Green', rgb: [0.3, 0.9, 0.35] },
  { id: 'pink', name: 'Bubblegum', rgb: [1.0, 0.45, 0.8] },
  { id: 'gold', name: 'Gold Star', rgb: [1.0, 0.8, 0.2] },
  { id: 'rainbow', name: 'Rainbow', rgb: null },
];

/** The colour to fly with: whatever is saved, else white. */
export function activeColour(data) {
  const c = SMOKE_COLOURS.find((k) => k.id === (data.smoke && data.smoke.color));
  return c || SMOKE_COLOURS[0];
}

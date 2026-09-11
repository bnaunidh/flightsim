/**
 * Airline liveries.
 *
 * A named paint scheme: base colour, the cheatline that runs along the body,
 * the tail colour, and a registration. The class asked for Ethiopian, United,
 * American, Air France and Air India by name; these are originals styled after
 * that kind of airline instead, because the real ones are those companies'
 * trademarks and this game is published on a public site. Renaming them is a
 * one-line change per entry if that is ever wanted.
 *
 * The tail is a SEPARATE material rather than part of the shared texture, and
 * that is not a stylistic choice — it is forced by the geometry. The fuselage
 * is a lathe whose UVs run u=around, v=nose-to-tail, and the wings are lofted
 * with u=around-the-aerofoil, v=spanwise. Both are handed the same square
 * image, so a stripe painted at a constant y comes out as a RING around the
 * body and a spanwise band across the wing — never as a cheatline, and never
 * as a coloured fin. Colouring the tail is the single thing that makes a
 * scheme read as an airline from a distance, so it gets its own material.
 */

/** Every scheme. `base`/`accent` feed the shared texture; `tail` is its own. */
export const LIVERIES = [
  {
    id: 'house',
    name: 'House colours',
    blurb: 'The factory scheme each aeroplane arrives in',
    house: true, // means "use whatever the aircraft type already declares"
  },
  {
    id: 'abyssinia',
    name: 'Abyssinia Air',
    blurb: 'Green and gold over white',
    base: '#f4f6f8',
    accent: '#0b8a3e',
    cheatline: 'rgba(232,180,10,0.9)',
    tail: 0x0b8a3e,
    reg: 'ET-ABY',
  },
  {
    id: 'continental',
    name: 'Continental States',
    blurb: 'Two blues and a grey belly',
    base: '#dfe4ea',
    accent: '#1a4f8a',
    cheatline: 'rgba(13,47,86,0.92)',
    tail: 0x0d2f56,
    reg: 'N480CS',
  },
  {
    id: 'liberty',
    name: 'Liberty Air',
    blurb: 'Bare metal, red and blue',
    base: '#d6dadf',
    accent: '#c8102e',
    cheatline: 'rgba(20,52,120,0.9)',
    tail: 0xc8102e,
    reg: 'N711LB',
  },
  {
    id: 'bleuciel',
    name: 'Bleu Ciel',
    blurb: 'Navy, white and a red fin',
    base: '#f7f8fa',
    accent: '#12306b',
    cheatline: 'rgba(200,20,40,0.9)',
    tail: 0x12306b,
    reg: 'F-BCLX',
  },
  {
    id: 'bharat',
    name: 'Bharat Air',
    blurb: 'Saffron and green',
    base: '#fbf7f0',
    accent: '#e8721f',
    cheatline: 'rgba(31,122,68,0.9)',
    tail: 0xe8721f,
    reg: 'VT-BHA',
  },
  {
    id: 'nightfreight',
    name: 'Night Freight',
    blurb: 'Charcoal, for the small hours',
    base: '#3a4046',
    accent: '#e8a33c',
    cheatline: 'rgba(232,163,60,0.5)',
    tail: 0x24282d,
    reg: 'N90NF',
  },
];

export function findLivery(id) {
  return LIVERIES.find((l) => l.id === id) || LIVERIES[0];
}

/**
 * Resolve a scheme for one aircraft.
 *
 * The "house colours" entry is not a scheme of its own — it means "whatever
 * this type declares", which is what keeps every aeroplane looking like itself
 * by default and stops the picker overwriting the fleet's own identity.
 */
export function schemeFor(type, liveryId) {
  const l = findLivery(liveryId);
  if (l.house || !type) {
    return {
      id: 'house',
      name: 'House colours',
      base: (type && type.livery) || '#eef1f5',
      accent: (type && type.accent) || '#c8102e',
      cheatline: 'rgba(30,44,74,0.85)',
      tail: null, // null means "leave the fin in the body colour"
      reg: 'N172SK',
    };
  }
  return l;
}

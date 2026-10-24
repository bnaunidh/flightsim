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
 * The names are parody and must stay clearly different from any real airline's
 * name or callsign: never the real name, never a retired one (Continental was
 * a real airline — its scheme is "Ununited" now), never its logo. Colours are
 * fine on their own. tests/features/parody-names.mjs holds the list of real
 * names none of these may match; the credits screen says they are parody.
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
    titling: 'ABYSSINIA AIR',
    emblem: 'stripes',
    fleet: ['b737', 'b787', 'a350', 'b777', 'q400', 'meridian'],
  },
  {
    // The id stays 'continental' (it is in saved hangars and multiplayer
    // keys); the NAME was "Continental States", and Continental was a real
    // airline whose marks United still owns, so it is now the United parody
    // from the owner's safe-companies table. Same two blues, same grey belly.
    id: 'continental',
    name: 'Ununited',
    blurb: 'Two blues and a grey belly',
    base: '#dfe4ea',
    accent: '#1a4f8a',
    cheatline: 'rgba(13,47,86,0.92)',
    tail: 0x0d2f56,
    reg: 'N480UU',
    titling: 'UNUNITED',
    emblem: 'globe',
    fleet: ['b737', 'b777', 'b787', 'a320', 'a321', 'meridian'],
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
    titling: 'LIBERTY AIR',
    emblem: 'star',
    fleet: ['b737', 'a320', 'a321', 'b787', 'b777', 'meridian'],
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
    titling: 'BLEU CIEL',
    emblem: 'wave',
    // The A380 and Concorde: flown once, remembered for it.
    fleet: ['a320', 'a321', 'a350', 'b777', 'b787', 'a380', 'concorde', 'meridian'],
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
    titling: 'BHARAT AIR',
    emblem: 'sun',
    fleet: ['a320', 'a321', 'b787', 'b777', 'a350', 'b747', 'meridian'],
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
    titling: 'NIGHT FREIGHT',
    emblem: 'moon',
    fleet: ['b747', 'b777', 'q400', 'meridian'],
  },
  /*
   * "Air Force One" (src/game/extra/afo.js). A VC-25-style scheme — white
   * over a light-blue belly, the title the real one wears, a dark blue tail
   * — but an invented tail code, never one of the two real aircraft's: this
   * game names no real person or craft. `title` is new (see render/textures.js
   * airframeTexture()): a big line of text along the body, which no airline
   * scheme here has ever needed — a cheatline reads as an airline from a
   * distance, but this one has always carried words, not just colour.
   */
  {
    id: 'potus',
    name: 'Air Force One',
    blurb: 'White over light blue, flies the Commander in Chief',
    base: '#f4f3ee',
    accent: '#7fa9d6',
    cheatline: 'rgba(28,54,94,0.95)',
    tail: 0x1c365e,
    reg: 'SAM 42',
    title: 'UNITED STATES OF AMERICA',
    // Story-only: the hangar offers it (the player may fly it), but nothing
    // draws it at random. A random pick put the President's paint on the
    // second parked A380 and one ambient airliner in seven, and a callsign of
    // "Air Force One 47" on the radio.
    special: true,
  },
];

/**
 * The schemes a stand or a sky may hand out at random: real airlines only.
 * Not the house colours, which are no scheme, and not a `special` one.
 */
export const AIRLINE_LIVERIES = Object.freeze(LIVERIES.filter((l) => !l.house && !l.special));

/**
 * The airlines a type may be painted for when the world paints it for
 * itself (an apron, the traffic): each scheme's `fleet` is the types the
 * airline it is styled after really flies (2026-10-23 brief: "parody-airline
 * fleets only on types those real airlines fly"), so a Night Freight 787 or
 * an Abyssinia A380 never appears. A light aeroplane (a trainer, a tourer,
 * which wear airline paint as a flying-school or feeder would) may wear any
 * of them. An airliner no airline lists — the giants: a Beluga, an An-225 —
 * gets an empty list, and its caller keeps the house colours.
 *
 * Also what a scheme carries besides its colours, read by the airliner
 * models (src/fleet/extra/airliners.js dress()) and nothing else:
 *   titling   the airline's name along the forward fuselage, above the
 *             windows, as every real one wears it (`title` is Air Force
 *             One's, which the light aeroplanes paint too; this is not)
 *   emblem    the mark on the fin: 'stripes' | 'globe' | 'star' | 'wave' |
 *             'sun' | 'moon' — geometric, the game's own, never a real logo
 */
export function airlinesFor(type) {
  if (!type) return AIRLINE_LIVERIES;
  const airliner = type.category === 'airliner' || String(type.class || '').toLowerCase() === 'airliner';
  if (!airliner) return AIRLINE_LIVERIES;
  return AIRLINE_LIVERIES.filter((l) => Array.isArray(l.fleet) && l.fleet.includes(type.id));
}

/**
 * Does this type wear an airline's colours when the world paints it for
 * itself (an apron, a taxiing queue)? Airliners and the civil light aeroplanes
 * do; a fighter, a carrier jet, a racer or a novelty model keeps its own
 * paint. The apron used to hand every stand occupant an airline scheme, so
 * a parked F-22 stood there in Night Freight charcoal.
 */
export function wearsAirlinePaint(type) {
  if (!type) return false;
  if (type.military || type.category === 'military' || type.category === 'special') return false;
  const cls = String(type.class || '').toLowerCase();
  if (type.category === 'airliner' || cls === 'airliner') return true;
  return cls === 'trainer' || cls === 'tourer';
}

/**
 * The registration each type wears in its own house colours.
 *
 * Every aeroplane in the fleet used to be stamped N172SK — the Skylark's tail
 * number — because the house scheme hard-coded it and the airframe texture
 * fell back to the same string. The airliner, the fighter, the flying wing and
 * the helicopter all flew around wearing the trainer's registration, which is
 * the aviation equivalent of every car on the road having one number plate.
 *
 * A registration is paint, so it lives in the paint module beside the airline
 * ones the schemes already carry, and it is keyed by type id rather than by
 * position so adding an aeroplane cannot silently shift them all along. The
 * numbers match what the radio already calls each aeroplane — the Meridian
 * answers to "Meridian four two zero" and now carries 420 on its side. The
 * three types that fly for a service get a tail code instead of a civil
 * N-number, because that is what a military aeroplane has.
 *
 * A type that is not listed gets no registration at all, and nothing is
 * painted: a blank fuselage is honest, and someone else's number is not.
 */
const HOUSE_REGS = {
  skylark: 'N172SK',
  courier: 'N8PK',
  meridian: 'N420MD',
  tempest: 'N4WR',
  harrier: 'N3SH',
  vanguard: 'VG-01',
  osprey: 'CV-21',
  nightjar: 'NJ-02',
};

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
      reg: (type && HOUSE_REGS[type.id]) || null, // null means "paint no number"
    };
  }
  return l;
}

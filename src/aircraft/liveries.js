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
    // Inspired by the kind of airline that paints its flag's colours along the
    // body: three bands (green, gold, red) for the cheatline, the green of the
    // fin carried onto the engine cowls with a gold ring, a mid-grey belly.
    style: {
      layout: 'cheatline',
      bands: ['#0b8a3e', '#e8b40a', '#d9231f'],
      belly: '#aeb6bd',
      cowl: '#0b8a3e',
      cowlBand: '#e8b40a',
      emblemInks: ['#e8b40a', '#f4f6f8', '#d9231f'],
      titleWeight: 700,
      titleSpacing: 0.05,
      // Ethiopian-style: a warm, slightly flared bold sans.
      titleFont: { family: 'Kanit', weight: 600, style: 'normal' },
      // The fin's green, not the cheatline's gold: gold on a white body was
      // the one title in the fleet you could not read from the apron.
      titleInk: '#0b8a3e',
    },
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
    emblem: 'compass',
    fleet: ['b737', 'b777', 'b787', 'a320', 'a321', 'meridian'],
    // White over a deep-blue belly that rises to a gold pinstripe, navy fin
    // and cowls: the two-blues-and-gold look, with a compass for a mark (the
    // owner's table: "globe swapped for a compass").
    style: {
      layout: 'two-tone',
      belly: '#1a4f8a',
      pinstripe: '#d4a62a',
      cowl: '#0d2f56',
      cowlBand: '#d4a62a',
      titleWeight: 700,
      titleSpacing: 0.08,
      // United-style: a clean, wide geometric sans.
      titleFont: { family: 'Montserrat', weight: 700, style: 'normal' },
    },
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
    // Bare polished metal with a thin red-over-blue cheatline, a red fin
    // with the star, and bare-metal cowls: the classic American-style
    // "silver bird". Metal is metal here (airliner-kit airlinerMaterials).
    style: {
      layout: 'metal',
      metal: true,
      bands: ['#c8102e', '#143478'],
      cowl: '#c9ced3',
      emblemInks: ['#f4f6f8'],
      titleWeight: 700,
      titleSpacing: 0.06,
      // American-style: a squared, technical sans.
      titleFont: { family: 'Titillium Web', weight: 700, style: 'normal' },
      titleInk: '#12306b',
    },
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
    // Eurowhite: a clean white body with no cheatline, the name in navy, a
    // navy fin with the sweep (white over red), grey belly, white cowls.
    style: {
      layout: 'eurowhite',
      belly: '#b4bcc4',
      cowl: null,
      emblemInks: ['#f7f8fa', '#c8142a'],
      titleWeight: 600,
      titleSpacing: 0.1,
      // Air France-style: a Parisian geometric, Futura's cousin.
      titleFont: { family: 'Jost', weight: 600, style: 'normal' },
      titleInk: '#12306b',
    },
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
    // A warm white body, a saffron band above the windows with a thin red
    // line under it, saffron fin carrying the sun in deep red, red cowls with
    // a saffron ring.
    style: {
      layout: 'cheatline',
      bands: ['#e8721f', '#b3121b'],
      bandWeights: [3, 1],
      belly: '#b9bfc5',
      cowl: '#b3121b',
      cowlBand: '#e8721f',
      emblemInks: ['#b3121b'],
      titleWeight: 700,
      titleSpacing: 0.06,
      // Air India-style: the flowing italic of the old titling.
      titleFont: { family: 'Lora', weight: 600, style: 'italic' },
      titleInk: '#b3121b',
    },
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
    // Charcoal all over with an amber billboard name, black belly, amber
    // ring on charcoal cowls; the soot shows on a dark freighter.
    style: {
      layout: 'billboard',
      belly: '#1f2327',
      cowl: '#24282d',
      cowlBand: '#e8a33c',
      emblemInks: ['#e8a33c'],
      titleWeight: 800,
      titleSpacing: 0.12,
      // night-freighter: a condensed cargo face.
      titleFont: { family: 'Oswald', weight: 600, style: 'normal' },
      titleInk: '#e8a33c',
    },
  },
  /*
   * The owner's safe-parody table (briefs/next-week.md, "SAFE PARODY
   * COMPANIES", 2026-10-22): the real airline's colours, which colour alone
   * does not own, under a new name, with the game's own mark where the real
   * one puts its logo — the fin, and the name along the body — and nowhere
   * else (no engine, belly or winglet marks: ours have none either). Each
   * flies only the roster types the airline it is styled after really flies
   * (`fleet`), and the freight ones only the freighters. `callsign` is the
   * brand the radio reads (traffic.js): never a real callsign.
   */
  {
    // KLM-style: sky blue over white, a tulip for the crown.
    id: 'krd',
    name: 'Kanal Royal Dutch Air',
    callsign: 'Kanal',
    blurb: 'Sky blue over white, a tulip on the tail',
    base: '#f4f7fa',
    accent: '#39b4e6',
    cheatline: 'rgba(10,59,110,0.9)',
    tail: 0x39b4e6,
    reg: 'PH-KRD',
    titling: 'KANAL ROYAL DUTCH',
    emblem: 'tulip',
    fleet: ['b737', 'b777', 'b787', 'a321', 'meridian'],
    style: {
      layout: 'crown',
      crown: '#39b4e6',
      pinstripe: '#0a3b6e',
      belly: '#d6dde4',
      cowl: '#39b4e6',
      emblemInks: ['#f4f7fa', '#0a3b6e'],
      titleWeight: 700,
      titleSpacing: 0.08,
      // KLM-style: a bold, round geometric.
      titleFont: { family: 'League Spartan', weight: 700, style: 'normal' },
      titleInk: '#f4f7fa',
    },
  },
  {
    // Delta-style: white over a navy belly, a red fin — a wave-triangle, not a widget.
    id: 'riverdelta',
    name: 'Riverdelta Air',
    callsign: 'Riverdelta',
    blurb: 'White over navy, a red tail',
    base: '#f6f7f9',
    accent: '#003a70',
    cheatline: 'rgba(0,58,112,0.9)',
    tail: 0xc8102e,
    reg: 'N917RD',
    titling: 'RIVERDELTA',
    emblem: 'wavetri',
    fleet: ['b737', 'a320', 'a321', 'a350', 'meridian'],
    style: {
      layout: 'two-tone',
      belly: '#003a70',
      pinstripe: '#c8102e',
      cowl: '#003a70',
      emblemInks: ['#f6f7f9', '#8a0a1f'],
      titleWeight: 800,
      titleSpacing: 0.1,
      // Delta-style: a heavy, square-shouldered sans.
      titleFont: { family: 'Montserrat', weight: 800, style: 'normal' },
      titleInk: '#003a70',
    },
  },
  {
    // Emirates-style: a plain white body, gold titles, a red fin with a falcon.
    id: 'desertpearl',
    name: 'Desert Pearl Airlines',
    callsign: 'Desert Pearl',
    blurb: 'White, gold lettering, a red fin',
    base: '#f8f8f6',
    accent: '#c8a24a',
    cheatline: 'rgba(200,162,74,0.9)',
    tail: 0xd71920,
    reg: 'A6-DPL',
    titling: 'DESERT PEARL',
    emblem: 'falcon',
    fleet: ['a380', 'b777', 'a350', 'meridian'],
    style: {
      layout: 'eurowhite',
      belly: '#c9ced3',
      cowl: null,
      emblemInks: ['#c8a24a', '#f8f8f6'],
      titleWeight: 600,
      titleSpacing: 0.14,
      // Emirates-style: a high-contrast, elegant serif.
      titleFont: { family: 'Playfair Display', weight: 700, style: 'normal' },
      titleInk: '#b8902f',
    },
  },
  {
    // Etihad-style: warm sand over white, a geometric lattice on the fin.
    id: 'sandline',
    name: 'Sandline Air',
    callsign: 'Sandline',
    blurb: 'Warm sand and gold, a lattice tail',
    base: '#f7f4ee',
    accent: '#c9a66b',
    cheatline: 'rgba(160,120,70,0.9)',
    tail: 0xb08d57,
    reg: 'A6-SLN',
    titling: 'SANDLINE',
    emblem: 'lattice',
    fleet: ['a320', 'a321', 'a350', 'b787', 'b777', 'a380', 'meridian'],
    style: {
      layout: 'two-tone',
      belly: '#c9a66b',
      pinstripe: '#7a5a30',
      cowl: '#b08d57',
      emblemInks: ['#f7f4ee', '#e3cfa6', '#7a5a30'],
      titleWeight: 600,
      titleSpacing: 0.12,
      // Etihad-style: classical capitals, quiet luxury.
      titleFont: { family: 'Cinzel', weight: 700, style: 'normal' },
      titleInk: '#7a5a30',
    },
  },
  {
    // DHL-style freighter: yellow all over, red billboard name, red speed lines on the fin.
    id: 'dashfreight',
    name: 'Dash Freight',
    callsign: 'Dash Freight',
    blurb: 'Yellow all over with red lettering — a freighter',
    base: '#ffcc00',
    accent: '#d40511',
    cheatline: 'rgba(212,5,17,0.9)',
    tail: 0xffcc00,
    reg: 'D-ADSF',
    titling: 'DASH FREIGHT',
    emblem: 'speedlines',
    fleet: ['b737', 'b747', 'b777', 'meridian'],
    style: {
      layout: 'billboard',
      belly: '#b38f00',
      cowl: '#ffcc00',
      cowlBand: '#d40511',
      emblemInks: ['#d40511'],
      titleWeight: 900,
      titleSpacing: 0.1,
      // DHL-style: a fast, heavy italic.
      titleFont: { family: 'Exo 2', weight: 700, style: 'italic' },
      titleInk: '#d40511',
    },
  },
  {
    // FedEx-style freighter with the tones swapped: white, green and purple, a boxed arrow.
    id: 'flexship',
    name: 'FlexShip Express',
    callsign: 'FlexShip',
    blurb: 'White, green and purple — a freighter',
    base: '#f7f8fa',
    accent: '#1f8a4c',
    cheatline: 'rgba(77,20,140,0.9)',
    tail: 0x1f8a4c,
    reg: 'N77FS',
    titling: 'FLEXSHIP',
    emblem: 'arrowbox',
    fleet: ['b777', 'q400', 'meridian'],
    style: {
      layout: 'billboard',
      belly: '#c4c9cf',
      cowl: '#1f8a4c',
      cowlBand: '#4d148c',
      emblemInks: ['#f7f8fa', '#4d148c'],
      titleWeight: 900,
      titleSpacing: 0.06,
      // FedEx-style: a black, tight grotesque.
      titleFont: { family: 'Archivo Black', weight: 400, style: 'normal' },
      titleInk: '#4d148c',
    },
  },
  {
    // UPS-style freighter: white over brown, a gold pinstripe, a parcel badge on the fin.
    // The table said "shield with a box"; the real mark IS a shield, so ours is
    // a hexagon badge round a parcel — the brown is a registered colour mark
    // for delivery, so the shapes carry the difference (brief, 2026-10-22).
    id: 'parcelbrown',
    name: 'Parcel Brown Express',
    callsign: 'Parcel Brown',
    blurb: 'White over brown, a gold stripe — a freighter',
    base: '#f6f4f0',
    accent: '#351c15',
    cheatline: 'rgba(53,28,21,0.9)',
    tail: 0x351c15,
    reg: 'N58PB',
    titling: 'PARCEL BROWN EXPRESS',
    emblem: 'parcel',
    fleet: ['b747', 'meridian'],
    style: {
      layout: 'two-tone',
      belly: '#351c15',
      pinstripe: '#ffb500',
      cowl: '#351c15',
      cowlBand: '#ffb500',
      emblemInks: ['#ffb500', '#351c15'],
      titleWeight: 700,
      titleSpacing: 0.08,
      // UPS-style: a sturdy condensed sans.
      titleFont: { family: 'Barlow Condensed', weight: 700, style: 'normal' },
      titleInk: '#351c15',
    },
  },
  {
    // British Airways-style: white over a navy belly, the ribbon redrawn as a sea wave.
    id: 'royalisles',
    name: 'Royal Isles Airways',
    callsign: 'Royal Isles',
    blurb: 'White over navy, a red-and-white wave on the tail',
    base: '#f7f8fa',
    accent: '#075aaa',
    cheatline: 'rgba(7,90,170,0.9)',
    tail: 0x0d2f6b,
    reg: 'G-RIAW',
    titling: 'ROYAL ISLES AIRWAYS',
    emblem: 'seawave',
    fleet: ['a320', 'a321', 'a350', 'a380', 'b777', 'b787', 'concorde', 'meridian'],
    style: {
      layout: 'two-tone',
      belly: '#0d2f6b',
      pinstripe: '#eb2226',
      cowl: '#0d2f6b',
      emblemInks: ['#eb2226', '#f7f8fa'],
      titleWeight: 600,
      titleSpacing: 0.12,
      // British Airways-style: a crisp, upright geometric.
      titleFont: { family: 'Jost', weight: 700, style: 'normal' },
      titleInk: '#0d2f6b',
    },
  },
  {
    // Turkish Airlines-style: white, a red fin with a standing crane, navy titles.
    id: 'bosphorus',
    name: 'Bosphorus Air',
    callsign: 'Bosphorus',
    blurb: 'White with a red fin and a crane',
    base: '#f7f8fa',
    accent: '#c70a0c',
    cheatline: 'rgba(199,10,12,0.9)',
    tail: 0xc70a0c,
    reg: 'TC-BOS',
    titling: 'BOSPHORUS',
    emblem: 'crane',
    fleet: ['a320', 'a321', 'a350', 'b737', 'b777', 'b787', 'meridian'],
    style: {
      layout: 'eurowhite',
      belly: '#b9bfc5',
      cowl: null,
      emblemInks: ['#f7f8fa'],
      titleWeight: 700,
      titleSpacing: 0.1,
      // Turkish-style: a bold, even geometric.
      titleFont: { family: 'League Spartan', weight: 700, style: 'normal' },
      titleInk: '#1b1f5c',
    },
  },
  {
    // Qatar Airways-style: light grey, a maroon fin with a leaping antelope.
    id: 'pearlgulf',
    name: 'Pearl Gulf Airways',
    callsign: 'Pearl Gulf',
    blurb: 'Pearl grey with a maroon fin',
    base: '#d4d6d9',
    accent: '#5c0632',
    cheatline: 'rgba(92,6,50,0.9)',
    tail: 0x5c0632,
    reg: 'A7-PGA',
    titling: 'PEARL GULF',
    emblem: 'antelope',
    fleet: ['a320', 'a350', 'a380', 'b777', 'b787', 'meridian'],
    style: {
      layout: 'eurowhite',
      belly: '#a9adb2',
      cowl: '#5c0632',
      emblemInks: ['#d4d6d9'],
      titleWeight: 600,
      titleSpacing: 0.14,
      // Qatar-style: a refined serif, widely spaced.
      titleFont: { family: 'Playfair Display', weight: 700, style: 'normal' },
      titleInk: '#5c0632',
    },
  },
  {
    // Japan Airlines-style: white, a red fin, black titles; a rising sun with a crane in flight.
    id: 'risingcrane',
    name: 'Rising Crane Air',
    callsign: 'Rising Crane',
    blurb: 'White with a red fin and a rising sun',
    base: '#f8f8f8',
    accent: '#b60005',
    cheatline: 'rgba(182,0,5,0.9)',
    tail: 0xb60005,
    reg: 'JA801C',
    titling: 'RISING CRANE',
    emblem: 'suncrane',
    fleet: ['b737', 'b777', 'b787', 'a350', 'meridian'],
    style: {
      layout: 'eurowhite',
      belly: '#bfc3c7',
      cowl: null,
      emblemInks: ['#f8f8f8', '#ffd166'],
      titleWeight: 700,
      titleSpacing: 0.1,
      // JAL-style: a firm sans with an Asian warmth.
      titleFont: { family: 'Kanit', weight: 600, style: 'normal' },
      titleInk: '#1a1a1a',
    },
  },
  {
    // Spirit-style: a lighter yellow all over, black lettering, an exclamation mark.
    id: 'spit',
    name: 'Spit Air',
    callsign: 'Spit',
    blurb: 'Bright yellow all over, black lettering',
    base: '#ffe73a',
    accent: '#1a1a1a',
    cheatline: 'rgba(26,26,26,0.9)',
    tail: 0xffe73a,
    reg: 'N52SP',
    titling: 'SPIT AIR',
    emblem: 'bang',
    fleet: ['a320', 'a321', 'meridian'],
    style: {
      layout: 'billboard',
      belly: '#c9b31f',
      cowl: '#ffe73a',
      cowlBand: '#1a1a1a',
      emblemInks: ['#1a1a1a'],
      titleWeight: 900,
      titleSpacing: 0.14,
      // Spirit-style: black, loud, low-cost.
      titleFont: { family: 'Archivo Black', weight: 400, style: 'normal' },
      titleInk: '#1a1a1a',
    },
  },
  {
    // The owner's own: ocean teal over white, a ring horizon on the fin. Original.
    id: 'oversea',
    name: 'OverSea Airways',
    callsign: 'OverSea',
    blurb: 'White over ocean teal — the island\'s own airline',
    base: '#f5f8fa',
    accent: '#0f6e8c',
    cheatline: 'rgba(15,110,140,0.9)',
    tail: 0x0f6e8c,
    reg: 'N70SA',
    titling: 'OVERSEA AIRWAYS',
    emblem: 'horizon',
    fleet: ['a320', 'a321', 'b737', 'b787', 'a350', 'b777', 'q400', 'meridian'],
    style: {
      layout: 'two-tone',
      belly: '#0f6e8c',
      pinstripe: '#f2b84b',
      cowl: '#0f6e8c',
      cowlBand: '#f2b84b',
      emblemInks: ['#f5f8fa', '#f2b84b'],
      titleWeight: 700,
      titleSpacing: 0.1,
      // the island's own: a sporty, forward-leaning italic.
      titleFont: { family: 'Exo 2', weight: 700, style: 'italic' },
      titleInk: '#0f6e8c',
    },
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
    // White over a light-blue belly that rises to the navy cheatline; light
    // blue cowls. Inspired by the VC-25's two-tone, our own art, no seal.
    style: {
      layout: 'two-tone',
      belly: '#7fa9d6',
      pinstripe: '#c9a227',
      cowl: '#7fa9d6',
      titleWeight: 600,
      titleSpacing: 0.14,
      // the VC-25's Caslon-style serif.
      titleFont: { family: 'Playfair Display', weight: 700, style: 'normal' },
      titleInk: '#1c365e',
    },
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

/** Every fin mark the airliner models can draw (fleet/extra/airliners.js emblemTexture). */
export const EMBLEMS = Object.freeze([
  'stripes', 'compass', 'star', 'wave', 'sun', 'moon',
  'tulip', 'wavetri', 'falcon', 'lattice', 'speedlines', 'arrowbox', 'parcel', 'seawave', 'crane', 'antelope', 'suncrane', 'bang', 'horizon',
]);

/** The paint layouts liveryTexture knows. */
export const LAYOUTS = Object.freeze(['cheatline', 'eurowhite', 'two-tone', 'billboard', 'metal', 'crown']);

/** The brand an ambient aeroplane's radio call starts with: "Kanal four two", "Night Freight one five". */
export function radioBrand(livery) {
  if (!livery) return '';
  if (typeof livery.callsign === 'string' && livery.callsign.trim()) return livery.callsign.trim();
  return String(livery.name || '').replace(/\s+(Air|States)$/i, '');
}

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
 *   callsign  the brand the radio reads for an ambient aeroplane ("Kanal
 *             four two"); the name with a trailing Air/States dropped if unset
 *   emblem    the mark on the fin: 'stripes' | 'compass' | 'star' | 'wave' |
 *             'sun' | 'moon' | 'tulip' | 'wavetri' | 'falcon' | 'lattice' |
 *             'speedlines' | 'arrowbox' | 'parcel' | 'seawave' | 'crane' |
 *             'antelope' | 'suncrane' | 'bang' | 'horizon' — geometric, the
 *             game's own, never a real logo (EMBLEMS below is the list)
 *   style     how the paint is laid out (fleet/extra/airliner-kit.js
 *             liveryTexture, airlinerMaterials; all optional, all data):
 *     layout      'cheatline' (a band under the windows), 'eurowhite' (a
 *                 plain body, the name does the work), 'two-tone' (the belly
 *                 colour rises to the cheatline), 'billboard' (a dark body,
 *                 big name), 'metal' (bare polished skin, a thin cheatline),
 *                 'crown' (the upper body in `crown`, down to the window
 *                 line, over a pale belly: the sky-blue-over-white look)
 *     crown       the upper body's colour (crown layout); the accent if not set
 *     bands       the cheatline as a list of colours, top to bottom, instead
 *                 of one accent band and a line
 *     bandWeights the bands' relative heights (equal if not set)
 *     belly       the belly colour (css); a greyer shade of the body if not set
 *     pinstripe   a thin line where the belly colour meets the body (two-tone)
 *     metal       true for bare metal: the material is metal, the skin brushed
 *     cowl        the engine fan cowls' colour (css); the body colour if null
 *     cowlBand    a ring round the front of each cowl
 *     emblemInks  the mark's colours (one, or one per part of it); the body
 *                 colour if not set
 *     titleWeight, titleSpacing, titleInk   the name's weight (400-900),
 *                 letter spacing (em) and colour (the cheatline's if not set)
 *     titleFont   the name's typeface, { family, weight, style }: one of the
 *                 bundled OFL faces (render/airline-fonts.js), the nearest free
 *                 cousin of the lettering the real airline wears — never its own
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
  bell407: 'N407IB',
  h145: 'N145HX',
  r44: 'N44RJ',
  aw139: 'N139SR',
  uh60: '26-021',
  ch47: '08-771',
  ah64: '09-640',
  vanguard: 'VG-01',
  osprey: 'CV-21',
  nightjar: 'NJ-02',
};

/*
 * Schemes that belong to ONE type and are never offered to any other: the
 * presidential Sea King's white top over dark green (aircraft/extra/helis.js
 * 'vh3d', `fixedLivery`). Like the Air Force One paint above it is the
 * game's own art — the colours and the title the real one wears, a gold
 * star roundel of our own on the door, no seal, no real serial — and, like
 * it, nothing ever draws it at random: it is not in LIVERIES, so neither an
 * apron nor the traffic nor the Settings list can hand it out.
 */
export const TYPE_SCHEMES = Object.freeze([
  {
    id: 'marine-one',
    name: 'Marine One',
    blurb: 'White top over dark green, flies the Commander in Chief',
    base: '#22352a',
    accent: '#c9a227',
    // The titling ink (civil-details.js fuselageLettering reads the cheatline).
    cheatline: '#f2f1ea',
    tail: null,
    reg: null,
    title: 'UNITED STATES OF AMERICA',
    upper: '#f3f2ec',
    upperTo: 0.6,
    pinstripe: '#b8962e',
    special: true,
  },
]);

export function findLivery(id) {
  return LIVERIES.find((l) => l.id === id) || TYPE_SCHEMES.find((l) => l.id === id) || LIVERIES[0];
}

/** The paints this type may be shown in: its own fixed scheme alone, or every scheme. */
export function liveriesFor(type) {
  if (type && type.fixedLivery) {
    const own = TYPE_SCHEMES.find((l) => l.id === type.fixedLivery);
    if (own) return [own];
  }
  return LIVERIES;
}

/**
 * Resolve a scheme for one aircraft.
 *
 * The "house colours" entry is not a scheme of its own — it means "whatever
 * this type declares", which is what keeps every aeroplane looking like itself
 * by default and stops the picker overwriting the fleet's own identity.
 */
export function schemeFor(type, liveryId) {
  // A type with a scheme of its own (Marine One) wears it whatever is picked,
  // the way the President's 747 is only ever in the Air Force One paint.
  if (type && type.fixedLivery) {
    const own = TYPE_SCHEMES.find((l) => l.id === type.fixedLivery);
    if (own) return own;
  }
  const l = findLivery(liveryId);
  // A scheme that belongs to one type is never worn by another.
  if (l.house || !type || TYPE_SCHEMES.includes(l)) {
    // `paint` (helicopters: aircraft/extra/helis.js) says how the house colours
    // are laid on — `plain` (no stripes) for a service machine, `finish:
    // 'matte'` for the flat paint an army helicopter wears.
    const paint = (type && type.paint) || {};
    return {
      id: 'house',
      name: 'House colours',
      base: (type && type.livery) || '#eef1f5',
      accent: (type && type.accent) || '#c8102e',
      cheatline: 'rgba(30,44,74,0.85)',
      tail: null, // null means "leave the fin in the body colour"
      reg: (type && HOUSE_REGS[type.id]) || null, // null means "paint no number"
      ...(paint.plain ? { plain: true } : {}),
      ...(paint.finish ? { finish: paint.finish } : {}),
    };
  }
  return l;
}

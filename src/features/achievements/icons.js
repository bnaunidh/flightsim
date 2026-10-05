/**
 * Achievement badge icons.
 *
 * The owner's words, verbatim: "achievemetns icons looking creepy" — the
 * original hand-drawn line glyphs (a stick man for "formation", a round head
 * for "seal") read as faces and figures in a pale ring. These are real,
 * recognisable objects instead: Tabler Icons (MIT), inlined as path data
 * under assets/icons/LICENSES.md's terms — no network fetch at runtime, no
 * build step, just the same string-building this module always did.
 *
 * Each badge is a solid, tiered medallion (bronze/silver/gold/platinum) with
 * the icon in white on top, not a thin stroke in an empty ring — the
 * Xbox/Steam/Game-Center look the brief asked for. Locked = a grey
 * medallion, the icon dimmed, with a small lock. Hidden = a "?" medallion,
 * nothing given away.
 */

// One Tabler outline icon's path data per glyph id. Ids are unchanged from
// the original hand-drawn set (the catalogue in data.js and the node test
// both reference these by id, not by what they draw).
const ICONS = {
  // plane-departure: first take-off.
  wing: ['M14.639 10.258l4.83 -1.294a2 2 0 1 1 1.035 3.863l-14.489 3.883l-4.45 -5.02l2.897 -.776l2.45 1.414l2.897 -.776l-3.743 -6.244l2.898 -.777l5.675 5.727z', 'M3 21h18'],
  // plane-arrival: the gentlest landing.
  feather: ['M15.157 11.81l4.83 1.295a2 2 0 1 1 -1.036 3.863l-14.489 -3.882l-1.345 -6.572l2.898 .776l1.414 2.45l2.898 .776l-.12 -7.279l2.898 .777l2.052 7.797z', 'M3 21h18'],
  // wind: a crosswind.
  windsock: ['M5 8h8.5a2.5 2.5 0 1 0 -2.34 -3.24', 'M3 12h15.5a2.5 2.5 0 1 1 -2.34 3.24', 'M4 16h5.5a2.5 2.5 0 1 1 -2.34 3.24'],
  // building-airport: every aeroplane home at once.
  hangar: [
    'M3.59 7h8.82a1 1 0 0 1 .902 1.433l-1.44 3a1 1 0 0 1 -.901 .567h-5.942a1 1 0 0 1 -.901 -.567l-1.44 -3a1 1 0 0 1 .901 -1.433',
    'M6 7l-.78 -2.342a.5 .5 0 0 1 .473 -.658h4.612a.5 .5 0 0 1 .475 .658l-.78 2.342',
    'M8 2v2',
    'M6 12v9h4v-9',
    'M3 21h18',
    'M22 5h-6l-1 -1',
    'M18 3l2 2l-2 2',
    'M10 17h7a2 2 0 0 1 2 2v2',
  ],
  // world: every map.
  globe: ['M3 12a9 9 0 1 0 18 0a9 9 0 0 0 -18 0', 'M3.6 9h16.8', 'M3.6 15h16.8', 'M11.5 3a17 17 0 0 0 0 18', 'M12.5 3a17 17 0 0 1 0 18'],
  // anchor: the carrier trap.
  anchor: ['M12 9v12m-8 -8a8 8 0 0 0 16 0m1 0h-2m-14 0h-2', 'M12 6m-3 0a3 3 0 1 0 6 0a3 3 0 1 0 -6 0'],
  // star: the top of the sky.
  star: ['M12 17.75l-6.172 3.245l1.179 -6.873l-5 -4.867l6.9 -1l3.086 -6.253l3.086 6.253l6.9 1l-5 4.867l1.179 6.873z'],
  // medal: mission and score badges.
  medal: ['M12 4v3m-4 -3v6m8 -6v6', 'M12 18.5l-3 1.5l.5 -3.5l-2 -2l3 -.5l1.5 -3l1.5 3l3 .5l-2 2l.5 3.5z'],
  // helicopter: Rotors Up.
  rotor: ['M3 10l1 2h6', 'M12 9a2 2 0 0 0 -2 2v3c0 1.1 .9 2 2 2h7a2 2 0 0 0 2 -2c0 -3.31 -3.13 -5 -7 -5h-2z', 'M13 9l0 -3', 'M5 6l15 0', 'M15 9.1v3.9h5.5', 'M15 19l0 -3', 'M19 19l-8 0'],
  // sailboat: Casting Off.
  boat: [
    'M2 20a2.4 2.4 0 0 0 2 1a2.4 2.4 0 0 0 2 -1a2.4 2.4 0 0 1 2 -1a2.4 2.4 0 0 1 2 1a2.4 2.4 0 0 0 2 1a2.4 2.4 0 0 0 2 -1a2.4 2.4 0 0 1 2 -1a2.4 2.4 0 0 1 2 1a2.4 2.4 0 0 0 2 1a2.4 2.4 0 0 0 2 -1',
    'M4 18l-1 -3h18l-1 3',
    'M11 12h7l-7 -9v9',
    'M8 7l-2 5',
  ],
  // car: Key in the Ignition.
  car: ['M7 17m-2 0a2 2 0 1 0 4 0a2 2 0 1 0 -4 0', 'M17 17m-2 0a2 2 0 1 0 4 0a2 2 0 1 0 -4 0', 'M5 17h-2v-6l2 -5h9l4 5h1a2 2 0 0 1 2 2v4h-2m-4 0h-6m-6 -6h15m-6 0v-5'],
  // rocket: Three, Two, One.
  rocket: ['M4 13a8 8 0 0 1 7 7a6 6 0 0 0 3 -5a9 9 0 0 0 6 -8a3 3 0 0 0 -3 -3a9 9 0 0 0 -8 6a6 6 0 0 0 -5 3', 'M7 14a6 6 0 0 0 -3 6a6 6 0 0 0 6 -3', 'M15 9m-1 0a1 1 0 1 0 2 0a1 1 0 1 0 -2 0'],
  // flag: the race win.
  flag: ['M5 5a5 5 0 0 1 7 0a5 5 0 0 0 7 0v9a5 5 0 0 1 -7 0a5 5 0 0 0 -7 0v-9z', 'M5 21v-7'],
  // plane: Squadron — one aeroplane, not three stick figures.
  formation: ['M16 10h4a2 2 0 0 1 0 4h-4l-4 7h-3l2 -7h-4l-2 2h-3l2 -4l-2 -4h3l2 2h4l-2 -7h3z'],
  // crown: command — Captain and the rank milestones. No face, no laurel head.
  seal: ['M12 6l4 6l5 -4l-2 10h-14l-2 -10l5 4z'],
  // shield: the secure room.
  shield: ['M12 3a12 12 0 0 0 8.5 3a12 12 0 0 1 -8.5 15a12 12 0 0 1 -8.5 -15a12 12 0 0 0 8.5 -3'],
  // bolt: top speed.
  bolt: ['M13 3l0 7l6 0l-8 11l0 -7l-6 0l8 -11'],
  // trophy: the completionist.
  trophy: ['M8 21l8 0', 'M12 17l0 4', 'M7 4l10 0', 'M17 4v8a5 5 0 0 1 -10 0v-8', 'M5 9m-2 0a2 2 0 1 0 4 0a2 2 0 1 0 -4 0', 'M19 9m-2 0a2 2 0 1 0 4 0a2 2 0 1 0 -4 0'],
  // moon: a night landing.
  moon: ['M12 3c.132 0 .263 0 .393 0a7.5 7.5 0 0 0 7.92 12.446a9 9 0 1 1 -8.313 -12.454z'],
  // cloud-rain: weather.
  cloud: ['M7 18a4.6 4.4 0 0 1 0 -9a5 4.5 0 0 1 11 2h1a3.5 3.5 0 0 1 0 7', 'M11 13v2m0 3v2m4 -5v2m0 3v2'],
  // ticket: Frequent Flyer.
  ticket: ['M15 5l0 2', 'M15 11l0 2', 'M15 17l0 2', 'M5 5h14a2 2 0 0 1 2 2v3a2 2 0 0 0 0 4v3a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2v-3a2 2 0 0 0 0 -4v-3a2 2 0 0 1 2 -2'],
};

// Tabler's "lock" icon, for the small lock badge on a locked (but known) medallion.
const LOCK_PATHS = ['M5 13a2 2 0 0 1 2 -2h10a2 2 0 0 1 2 2v6a2 2 0 0 1 -2 2h-10a2 2 0 0 1 -2 -2v-6z', 'M11 16a1 1 0 1 0 2 0a1 1 0 0 0 -2 0', 'M8 11v-4a4 4 0 1 1 8 0v4'];

/** The four earn-it tiers, easy to hard. data.js's catalogue names one per achievement. */
const TIERS = {
  bronze: { from: '#dd9a5c', to: '#8a4a12', rim: 'rgba(255,214,168,0.8)' },
  silver: { from: '#eef2f6', to: '#8b96a6', rim: 'rgba(255,255,255,0.85)' },
  gold: { from: '#ffdd80', to: '#b9842a', rim: 'rgba(255,246,214,0.9)' },
  platinum: { from: '#eaf7ff', to: '#87a9c4', rim: 'rgba(255,255,255,0.95)' },
};
const LOCKED_TONE = { from: '#7b8494', to: '#3f4654', rim: 'rgba(255,255,255,0.3)' };

let uid = 0;
const drawPaths = (d) => d.map((p) => `<path d="${p}"/>`).join('');

/**
 * A self-contained badge: a solid medallion in `tier`'s colour, the icon in
 * white on top, a soft sheen near the top for a bit of shine.
 *
 * `state`: 'unlocked' (default, full colour and a crisp icon), 'locked' (a
 * grey medallion, the icon at 35% opacity, a small lock badge) or 'hidden'
 * (a grey medallion with "?" — the icon and the lock both stay unknown).
 * `glyph` falling back to the star is a typo's own achievement never
 * silently going blank — the node test asserts every catalogue entry names a
 * real one, so the fallback is a safety net, not a plan.
 */
export function badgeSvg(glyph, { tier = 'bronze', size = 28, state = 'unlocked' } = {}) {
  const locked = state === 'locked';
  const hidden = state === 'hidden';
  const tone = locked || hidden ? LOCKED_TONE : TIERS[tier] || TIERS.bronze;
  const gid = `achg${uid++}`;
  const d = ICONS[glyph] || ICONS.star;

  const face = hidden
    ? `<text x="24" y="24" dominant-baseline="central" text-anchor="middle" font-size="22" font-weight="700" fill="#fff" font-family="inherit">?</text>`
    : `<g transform="translate(12,12)" fill="none" stroke="#fff" stroke-opacity="${locked ? 0.35 : 1}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${drawPaths(d)}</g>`;

  const lockBadge = locked
    ? `<g transform="translate(28,28)">` +
      `<circle cx="7" cy="7" r="8.5" fill="#262c3a" stroke="rgba(255,255,255,0.45)" stroke-width="1"/>` +
      `<g transform="translate(2.6,2.6) scale(0.37)" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">${drawPaths(LOCK_PATHS)}</g>` +
      `</g>`
    : '';

  return (
    `<svg viewBox="0 0 48 48" width="${size}" height="${size}" aria-hidden="true" focusable="false">` +
    `<defs><radialGradient id="${gid}" cx="35%" cy="28%" r="75%">` +
    `<stop offset="0%" stop-color="${tone.from}"/><stop offset="100%" stop-color="${tone.to}"/>` +
    `</radialGradient></defs>` +
    `<circle cx="24" cy="24" r="21" fill="url(#${gid})" stroke="${tone.rim}" stroke-width="1.5"/>` +
    `<ellipse cx="24" cy="15" rx="13" ry="6" fill="rgba(255,255,255,0.16)"/>` +
    face +
    lockBadge +
    `</svg>`
  );
}

/** For the node test: every glyph name this file actually draws. */
export const GLYPH_IDS = Object.keys(ICONS);

/** For the node test: every tier this file actually draws. */
export const TIER_IDS = Object.keys(TIERS);

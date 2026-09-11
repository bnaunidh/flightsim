/**
 * Icons.
 *
 * The interface used to lean on whatever glyphs a font happened to have —
 * ❚❚ for pause, ⌂ for the airfield, ▣ for a clean screenshot. They rendered at
 * different weights and sizes depending on the machine, several of them were
 * genuinely hard to read, and two were emoji that turned coloured on some
 * systems and not others.
 *
 * These are drawn instead: one 24×24 grid, one stroke weight, `currentColor`
 * throughout, so they inherit whatever the button is doing and look like a set.
 * No files and no icon font — they are strings.
 */

const P = {
  /* ---- flight controls ---- */
  pause: '<rect x="8" y="5" width="3.2" height="14" rx="1.2"/><rect x="12.8" y="5" width="3.2" height="14" rx="1.2"/>',
  play: '<path d="M8 5.5 19 12 8 18.5Z"/>',
  camera:
    '<path d="M3 8.5a2 2 0 0 1 2-2h2.2l1.3-2h6.9l1.3 2H19a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/><circle cx="12" cy="12.5" r="3.4"/>',
  // A dotted route with a waypoint on it: the guidance rails.
  route:
    '<path d="M4 19c4.5 0 4-6 8.5-6S17 7 21 7" stroke-dasharray="3 2.6"/><circle cx="12.5" cy="13" r="2.1"/>',
  autopilot:
    '<circle cx="12" cy="12" r="8"/><path d="M12 4v3.4M12 16.6V20M4 12h3.4M16.6 12H20"/><circle cx="12" cy="12" r="2.2"/>',
  // An empty frame: the view with nothing drawn over it.
  cinematic:
    '<path d="M4 8V5.5A1.5 1.5 0 0 1 5.5 4H8M16 4h2.5A1.5 1.5 0 0 1 20 5.5V8M20 16v2.5a1.5 1.5 0 0 1-1.5 1.5H16M8 20H5.5A1.5 1.5 0 0 1 4 18.5V16"/>',
  restart: '<path d="M20 12a8 8 0 1 1-2.6-5.9"/><path d="M20 4v4.6h-4.6"/>',
  // A control tower, for "back to the airfield".
  tower:
    '<path d="M9 21V10l3-6 3 6v11"/><path d="M7.5 10h9"/><path d="M9.6 14.5h4.8"/><path d="M12 4V2.5"/>',
  soundOn: '<path d="M4 9.5h3.5L12 5.5v13L7.5 14.5H4Z"/><path d="M15.5 9.4a3.8 3.8 0 0 1 0 5.2M18.2 6.9a7.4 7.4 0 0 1 0 10.2"/>',
  soundOff: '<path d="M4 9.5h3.5L12 5.5v13L7.5 14.5H4Z"/><path d="m16 10 5 4M21 10l-5 4"/>',
  help: '<circle cx="12" cy="12" r="8.6"/><path d="M9.5 9.6a2.6 2.6 0 0 1 5 .9c0 1.8-2.5 2-2.5 3.6"/><circle cx="12" cy="17.2" r="0.9" fill="currentColor" stroke="none"/>',
  more: '<circle cx="5.5" cy="12" r="1.5" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none"/><circle cx="18.5" cy="12" r="1.5" fill="currentColor" stroke="none"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',

  /* ---- menu ---- */
  plane: '<path d="M12 2.6c1.5 0 2.1 2.4 2.2 5.4l6.6 4.1v2.3l-6.6-2v3.9l2.3 1.7v1.7L12 19l-4.5.7v-1.7l2.3-1.7v-3.9l-6.6 2v-2.3L9.8 8c.1-3 .7-5.4 2.2-5.4Z"/>',
  target: '<circle cx="12" cy="12" r="8.4"/><circle cx="12" cy="12" r="4.4"/><circle cx="12" cy="12" r="0.9" fill="currentColor" stroke="none"/>',
  cloud: '<path d="M7.2 18.5A4.2 4.2 0 0 1 7 10.1a5.4 5.4 0 0 1 10.3 1.2 3.6 3.6 0 0 1-.6 7.2Z"/>',
  map: '<path d="m3 6.6 6-2.4 6 2.4 6-2.4v13.2l-6 2.4-6-2.4-6 2.4Z"/><path d="M9 4.2v13.2M15 6.6v13.2"/>',
  gear:
    '<circle cx="12" cy="12" r="3.1"/><path d="M12 2.8v2.6M12 18.6v2.6M21.2 12h-2.6M5.4 12H2.8M18.5 5.5l-1.8 1.8M7.3 16.7l-1.8 1.8M18.5 18.5l-1.8-1.8M7.3 7.3 5.5 5.5"/>',
  // A wing with a lift arrow: learning to fly.
  learn: '<path d="M3.5 15.5c5.5 1.6 11 .6 17-3.6"/><path d="M14.6 6.2 20.5 12l-6.6 2"/><path d="M4 19.6h8"/>',
  hangar: '<path d="M3 20V11a9 9 0 0 1 18 0v9"/><path d="M8 20v-5.5h8V20"/>',
  // A parked aeroplane at a stand: taxi out.
  gate: '<path d="M3 20h18"/><path d="M6 20v-6h5l3-3v9"/><path d="M14 11h5"/><circle cx="8.5" cy="17.5" r="1"/>',
  warning: '<path d="M12 4.2 21 19.4H3Z"/><path d="M12 10v4.2"/><circle cx="12" cy="17" r="0.9" fill="currentColor" stroke="none"/>',
  skip: '<path d="M5 6.5 13 12l-8 5.5Z"/><path d="M17.5 6v12"/>',
  check: '<path d="m5 12.8 4.4 4.4L19 7.6"/>',
  chevronLeft: '<path d="M14.5 5.5 8 12l6.5 6.5"/>',
  chevronRight: '<path d="M9.5 5.5 16 12l-6.5 6.5"/>',
  download: '<path d="M12 3.5v11"/><path d="m7.6 10.4 4.4 4.4 4.4-4.4"/><path d="M4.5 19.5h15"/>',
  // A speaking radio tower, for ATC.
  radio: '<path d="M12 21v-7"/><circle cx="12" cy="11.5" r="2.2"/><path d="M7.8 15.7a6 6 0 0 1 0-8.4M16.2 7.3a6 6 0 0 1 0 8.4"/><path d="M5.1 18.4a9.8 9.8 0 0 1 0-13.8M18.9 4.6a9.8 9.8 0 0 1 0 13.8"/>',
  fuel: '<path d="M4.5 20V5.5A1.5 1.5 0 0 1 6 4h6a1.5 1.5 0 0 1 1.5 1.5V20"/><path d="M3 20h12"/><path d="M6.8 8.4h4.4"/><path d="M13.5 9h3a1.5 1.5 0 0 1 1.5 1.5v5a1.5 1.5 0 0 0 3 0V8l-2.4-2.4"/>',

  /* ---- the switcher ---- */
  /* A helicopter is read from its rotor bar and its tail rotor, not its cabin,
     which is why both are drawn full width even at 18 px. */
  heli: '<path d="M3.5 6h17"/><path d="M12 6v2.6"/><path d="M7.5 8.6h6l2.5 3.4h4.5"/><path d="M7.5 8.6a3.4 3.4 0 0 0 0 6.8h6.5l2-3.4"/><path d="M19.5 10.2v3.6"/><path d="M6 18h9"/><path d="M8.5 15.4V18M13 15.4V18"/>',
  boat: '<path d="M3.5 14.5h17L18 19.5H6Z"/><path d="M8.5 14.5V9.5h5.5l2.4 5"/><path d="M11.2 9.5V6.2"/>',
  car: '<path d="M3.5 16v-2.6l2.2-4.2h8.6l3.6 4.2h2.6V16"/><path d="M3.5 16h1.6M18.9 16h1.6"/><circle cx="7.4" cy="16.4" r="2"/><circle cx="16.6" cy="16.4" r="2"/><path d="M9.4 16.4h5.2"/>',
  /* A coin with a C on it. Credits are the thing on the bar most likely to be
     glanced at rather than read, so it wants a silhouette, not a symbol. */
  credit: '<circle cx="12" cy="12" r="8.4"/><path d="M14.9 9.4a3.7 3.7 0 1 0 0 5.2"/>',
};

/**
 * One icon as an SVG string.
 * Everything is stroked in `currentColor`, so a button only has to set colour.
 */
export function icon(name, size = 20, extraClass = '') {
  const body = P[name];
  if (!body) return '';
  return (
    `<svg class="icon ${extraClass}" viewBox="0 0 24 24" width="${size}" height="${size}" ` +
    'fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" ' +
    `stroke-linejoin="round" aria-hidden="true" focusable="false">${body}</svg>`
  );
}

export const ICON_NAMES = Object.keys(P);

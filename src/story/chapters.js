/**
 * SIGNAL ZERO — the chapters, in order.
 *
 * Twelve chapters and an epilogue (story-bible.md §6). Each entry is what the
 * Story screen needs before anything is played: the number, the title, the
 * place, the vehicle, a spoiler-safe blurb and whether it has shipped. A
 * chapter that has shipped carries its module — the beats, the cutscenes,
 * the medals — from its own `chNN-*.js` file; one that has not shows as a
 * locked "coming soon" tile, number and "???" only.
 *
 * Everything is referenced by string id (never an index) so a save made today
 * still means the same thing after a chapter is re-authored.
 */

import { CHAPTER_1 } from './ch01-the-glint.js';

export const TITLE = 'SIGNAL ZERO';

export const CHAPTERS = [
  {
    id: 'ch01-the-glint',
    n: 1,
    title: 'The Glint',
    place: 'Condor Rock',
    when: '23:41',
    vehicle: 'Tempest WR-4',
    game: 'flight',
    map: 'condor',
    minutes: 6,
    blurb: 'A fireball is due over the western sea at midnight. The observatory pays for the first clean photo, and Cole Bannerman is up there too.',
    available: true,
    module: CHAPTER_1,
  },
  { id: 'ch02-fire-line', n: 2, title: 'Fire Line', place: 'Firewatch Ridge', when: '10:20', vehicle: 'Skyhook H-3', game: 'heli', map: 'firewatch', minutes: 7, blurb: 'Something else came down burning in the night. Two crew are cut off ahead of the fire.', available: false },
  { id: 'ch03-range-control', n: 3, title: 'Range Control', place: 'Aurora Fjords', when: '17:50', vehicle: 'Kestrel Courier', game: 'flight', map: 'fjord', minutes: 7, blurb: 'A medical run over the old corridor, and a voice on a frequency nobody uses.', available: false },
  { id: 'ch04-low-water', n: 4, title: 'Low Water', place: 'Longbank Sands', when: '05:40', vehicle: 'Kestrel Launch', game: 'boat', map: 'longbank', minutes: 8, blurb: 'The lowest tide of the year uncovers something forty years old.', available: false },
  { id: 'ch05-the-bridge', n: 5, title: 'The Bridge', place: 'Gateway International', when: '14:00', vehicle: 'Skyhook H-3 or police car', game: 'heli', map: 'gateway', minutes: 6, blurb: 'A truck with fake papers and a reporter in the left seat.', available: false },
  { id: 'ch06-mayday', n: 6, title: 'Mayday', place: 'Ironhead Air Base', when: '16:30', vehicle: 'Meridian 220', game: 'flight', map: 'airbase', minutes: 7, blurb: 'Forty seats, one engine on fire, and fighters on your wing.', available: false },
  { id: 'ch07-dark-road', n: 7, title: 'Dark Road', place: 'Cape Vessel', when: '01:10', vehicle: 'Harbourlight van', game: 'car', map: 'cape', minutes: 7, blurb: 'One road over the spine, lights off, and a door somebody left open.', available: false },
  { id: 'ch08-air-force-one', n: 8, title: 'Air Force One', place: 'Ironhead Air Base', when: '13:30', vehicle: 'escort fighter', game: 'flight', map: 'airbase', minutes: 9, blurb: 'The visit goes ahead. You fly Guardian Two.', available: false },
  { id: 'ch09-t-minus', n: 9, title: 'T-Minus', place: 'Cape Vessel', when: '22:30', vehicle: 'Petrel 9', game: 'rocket', map: 'cape', minutes: 7, blurb: 'Nobody has ever flown a rocket by hand. Congratulations.', available: false },
  { id: 'ch10-range-is-hot', n: 10, title: 'D-Day: Range Is Hot', place: 'Northwatch', when: '06:00', vehicle: 'carrier fighter', game: 'flight', map: 'northwatch', minutes: 9, blurb: 'Sirens at dawn on every island.', available: false },
  { id: 'ch11-shelter', n: 11, title: 'D-Day: Shelter', place: 'Gateway', when: '12:00', vehicle: 'everything', game: 'heli', map: 'gateway', minutes: 12, blurb: 'The islands go to ground, and you go everywhere at once.', available: false },
  { id: 'ch12-signal-zero', n: 12, title: 'D-Day: Signal Zero', place: 'Condor Rock → Raven Crag', when: '18:40', vehicle: 'on foot → Shearwater', game: 'flight', map: 'ravencrag', minutes: 10, blurb: 'A door in the rock, a key, and a canyon in a storm.', available: false },
  { id: 'epilogue-clear-skies', n: 13, title: 'Epilogue: Clear Skies', place: 'the islands', when: 'golden hour', vehicle: 'Shearwater', game: 'flight', map: 'kestrel', minutes: 5, blurb: 'No objectives. Just the islands, safe.', available: false, epilogue: true },
];

export const CHAPTER_IDS = CHAPTERS.map((c) => c.id);

export function chapterById(id) {
  return CHAPTERS.find((c) => c.id === id) || null;
}

/** The chapters that can be played today, in order. */
export function availableChapters() {
  return CHAPTERS.filter((c) => c.available && c.module);
}

/** How many of the twelve story chapters (the epilogue aside) there are. */
export const STORY_CHAPTER_COUNT = CHAPTERS.filter((c) => !c.epilogue).length;

/** "Chapter 4 of 12: Low Water" */
export function chapterLabel(c) {
  if (!c) return '';
  return c.epilogue ? c.title : `Chapter ${c.n} of ${STORY_CHAPTER_COUNT}: ${c.title}`;
}

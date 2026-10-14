/**
 * SIGNAL ZERO — the script.
 *
 * Every spoken line in the story lives here, by id, so the text lint
 * (tests/features/story.mjs), the per-chapter line budget and any future
 * translation all work on one file. The chapter modules refer to lines by id
 * and never carry text of their own.
 *
 * Voice is text and subtitles only (the project's no-TTS rule): a line is
 * shown in the dialogue box with a portrait and a coloured name tag, and the
 * radio ones also go out as the game's own formant chatter, which is the
 * acoustic shape of speech without words.
 *
 * Writing rules (story-bible.md §10, enforced by the lint):
 *   - most lines are 14 words or fewer, and a chapter has 40 lines or fewer;
 *   - no "epic" or "awesome" in dialogue, no exclamation spam;
 *   - humour comes from character, never from mocking the player;
 *   - RANGE CONTROL speaks in capitals, with no contractions;
 *   - no real country, person, brand or politics.
 */

/**
 * The cast. `colour` is the name tag; `voice` is which of the radio's
 * formant voices carries the line (audio/atc.js VOICES); `radio` false means
 * the line is spoken in the room (a cutscene), not over the air.
 *
 * Portraits are painted in code from `look` (story/portraits.js).
 */
export const CAST = {
  lark: {
    name: 'Lark',
    role: 'you · Harbourlight Charter',
    colour: '#eaf1fb',
    voice: 'instructor',
    // The player's face is never shown: a helmet and a visor.
    look: { kind: 'helmet', skin: '#c9a27e', visor: '#2a4b74', suit: '#2d3e55' },
    firstSeen: 1,
  },
  mara: {
    name: 'Mara Voss',
    role: 'Harbourlight Charter',
    colour: '#ffbf47',
    voice: 'ground',
    look: { kind: 'bust', skin: '#d7b08c', hair: '#c9c9c4', hairStyle: 'short', jacket: '#5a4632', shirt: '#7a8a7a', accessory: 'lanyard' },
    firstSeen: 1,
  },
  cole: {
    name: 'Cole Bannerman',
    role: 'freelance · will fly anything',
    colour: '#ff6a5c',
    voice: 'traffic',
    look: { kind: 'bust', skin: '#b98662', hair: '#2b2118', hairStyle: 'messy', jacket: '#7a2d26', shirt: '#e6d9b8', accessory: 'aviators' },
    firstSeen: 1,
  },
  priya: {
    name: 'Priya Castellano',
    role: 'The Islander · reporter',
    colour: '#3fd1c0',
    voice: 'approach',
    look: { kind: 'bust', skin: '#9c6a46', hair: '#1a1410', hairStyle: 'long', jacket: '#1f5a5a', shirt: '#f0ece0', accessory: 'press' },
    firstSeen: 2,
  },
  theo: {
    name: 'Theo Lindqvist',
    role: 'engineer · Thornefield Dynamics',
    colour: '#7ee07e',
    voice: 'instructor',
    look: { kind: 'bust', skin: '#e9c9a8', hair: '#b58b4a', hairStyle: 'curly', jacket: '#3c4a3c', shirt: '#c8d0c0', accessory: 'tablet' },
    firstSeen: 7,
  },
  alvarez: {
    name: 'Col. Marcus Alvarez',
    role: 'Guardian Lead · Ironhead Air Base',
    colour: '#7faadf',
    voice: 'tower',
    look: { kind: 'bust', skin: '#a9774f', hair: '#2d2a28', hairStyle: 'crop', jacket: '#3a4a3a', shirt: '#2a3426', accessory: 'kneeboard' },
    firstSeen: 6,
  },
  esi: {
    name: 'Chief Esi Dumas',
    role: 'Coast Guard',
    colour: '#ff9d3d',
    voice: 'approach',
    look: { kind: 'bust', skin: '#5c3a26', hair: '#141010', hairStyle: 'braids', jacket: '#d9542a', shirt: '#2a3a52', accessory: 'binoculars' },
    firstSeen: 4,
  },
  teague: {
    name: 'Simon Teague',
    role: 'CEO · Thornefield Dynamics',
    colour: '#a7b0bf',
    voice: 'ground',
    look: { kind: 'bust', skin: '#e2c4a6', hair: '#8c8c90', hairStyle: 'side', jacket: '#2c3140', shirt: '#eef0f4', accessory: 'tie' },
    firstSeen: 5,
  },
  president: {
    name: 'The President',
    role: '',
    colour: '#ffffff',
    voice: 'tower',
    look: { kind: 'bust', skin: '#c89a78', hair: '#5a5652', hairStyle: 'side', jacket: '#4a4440', shirt: '#f4f1ea', accessory: 'coat' },
    firstSeen: 8,
  },
  nadia: {
    name: 'Nadia',
    role: 'Kestrel Tower',
    colour: '#c9a6ff',
    voice: 'tower',
    look: { kind: 'bust', skin: '#efcfb0', hair: '#4a2c20', hairStyle: 'bun', jacket: '#2d3e55', shirt: '#dfe6f2', accessory: 'headset' },
    firstSeen: 1,
  },
  observatory: {
    name: 'Condor Observatory',
    role: 'the night watch',
    colour: '#9fd3ff',
    voice: 'village',
    look: { kind: 'bust', skin: '#d8b596', hair: '#6a5a50', hairStyle: 'crop', jacket: '#3b3f55', shirt: '#9fa8bf', accessory: 'headset' },
    firstSeen: 1,
  },
  range: {
    name: 'RANGE CONTROL',
    role: 'unknown frequency',
    colour: '#ff4d4d',
    voice: 'ground',
    look: { kind: 'screen' },
    firstSeen: 3,
  },
};

/**
 * The lines. `who` is a CAST key; `radio` false puts the line in the room.
 * Ids are `cN-…` by chapter so the lint can count a chapter's budget.
 */
export const LINES = {
  /* ---- Chapter 1 — The Glint ------------------------------------------ */
  'c1-obs-1': { who: 'observatory', text: 'Harbourlight, Observatory. It’s inbound now: big, green and early. First clean photo gets the fee.' },
  'c1-cole-1': { who: 'cole', text: 'Harbourlight, that’s my fireball. I called it.' },
  'c1-mara-1': { who: 'mara', text: 'Ignore him, Lark. Don’t be brave. Be early.' },
  'c1-lark-1': { who: 'lark', text: 'Copy. Climbing.' },
  'c1-obs-2': { who: 'observatory', text: 'There it is, off your right. It’s coming down fast.' },
  'c1-mara-2': { who: 'mara', text: 'Get alongside and hold it steady. Then take the shot.' },
  'c1-cole-2': { who: 'cole', text: 'Lovely weather for it. Try to keep up, new kid.' },
  'c1-lark-2': { who: 'lark', text: 'Alongside. Holding.' },
  'c1-mara-3': { who: 'mara', text: 'Got it. Harbourlight has the picture. Now turn for home.' },
  'c1-cole-3': { who: 'cole', text: 'Bannerman has the shot. Don’t say it wasn’t pretty.' },
  'c1-cole-4': { who: 'cole', text: 'Fine. Yours. Buy me a coffee with the fee.' },
  'c1-lark-3': { who: 'lark', text: 'That’s not a rock.' },
  'c1-nadia-1': { who: 'nadia', text: 'Harbourlight, Kestrel Tower on relay. Condor is wet, short, and ends in a cliff. Cleared for whatever it is you’re about to do.' },
  'c1-cole-5': { who: 'cole', text: 'Bannerman’s going home to Lowtown. Mind the cliff, Lark.' },
  'c1-mara-4': { who: 'mara', text: 'Short strip, wet. Land on the numbers, not past them.' },
  'c1-mara-5': { who: 'mara', text: 'Down. Good flying. Bring the camera inside.' },
  'c1-mara-6': { who: 'mara', text: 'You missed the gap. Round the squall costs time, not points.' },
  'c1-h-mara-1': { who: 'mara', radio: false, text: 'Who’s the new kid?' },
  'c1-h-cole-1': { who: 'cole', radio: false, text: 'Lark. Flew my checkride without spilling my coffee.' },
  'c1-h-mara-2': { who: 'mara', radio: false, text: 'Let’s see the picture.' },
  'c1-h-cole-2': { who: 'cole', radio: false, text: 'Rocks don’t have fins.' },
  'c1-h-mara-3': { who: 'mara', radio: false, text: '…Where exactly did you take this?' },
  'c1-h-lark-1': { who: 'lark', radio: false, text: 'Over the western sea. It bent, Mara. It steered.' },
  'c1-fail-splash': { who: 'mara', text: 'It splashed before you got the shot. Turn in sooner. It’s slow, but the sea is close.' },
  'c1-fail-crash': { who: 'mara', text: 'Everybody out and everybody fine. That’s the whole job. Again, from the checkpoint.' },
  'c1-secret-light': { who: 'lark', text: 'There’s a light in the west cliff. Nobody lives down there.' },
  'c1-file-1': { who: 'observatory', text: 'Harbourlight, we logged it from the dome. Your copy is in the file.' },
};

/**
 * "Previously on SIGNAL ZERO…" — one recap per chapter, spoiler-safe up to
 * that point. Shown when you Continue into the NEXT chapter, or back into
 * this one from a checkpoint (three short lines).
 */
export const RECAPS = {
  'ch01-the-glint': [
    'A fireball came down off Condor Rock.',
    'You raced Cole Bannerman through the squall for the photo.',
    'You got the shot. It was not a rock.',
  ],
  'ch02-fire-line': [
    'Something else fell on Firewatch Ridge.',
    'Thornefield took it before anyone could ask what it was.',
    'A reporter called Priya has questions.',
  ],
  'ch03-range-control': [
    'A voice calling itself Range Control told you to leave.',
    'A shape with no lights tried to make you.',
    'Mara knows more than she is saying.',
  ],
  'ch04-low-water': [
    'You pulled Gannet Two’s flight case off Longbank.',
    'Mara was its co-pilot.',
    '"It is not lightning."',
  ],
  'ch05-the-bridge': ['Thornefield tried to take the evidence.', 'Cole was driving.', 'Now he is on your side.'],
  'ch06-mayday': ['It came for your engine.', 'The Colonel saw it too.', 'Your reserve commission is back.'],
  'ch07-dark-road': ['SENTINEL is real, and it is counting down.', 'Phase Three is next.', 'The President lands tomorrow.'],
  'ch08-air-force-one': ['It hit Air Force One.', 'Everyone made it to the bunker.', 'The off switch needs a key. Mara has it.'],
  'ch09-t-minus': ['Your satellite found Blockhouse Zero inside Raven Crag.', 'Tomorrow, the clock hits zero.', ''],
  'ch10-range-is-hot': ['D-Day.', 'The sky over the evacuation held.', ''],
  'ch11-shelter': ['The islands are in their shelters.', 'Mara is waiting on Condor Rock.', ''],
  'ch12-signal-zero': ['You sent Signal Zero.', 'The range is safe.', 'Gannet Two is cleared home.'],
};

/**
 * The Kittiwake Files: one collectible per chapter, written as Priya's
 * research. Read in Story → Extras once found.
 */
export const FILES = {
  f01: {
    chapter: 'ch01-the-glint',
    title: 'File 01 — Observatory log, 23:44',
    where: 'Fly past the observatory’s lit window on The Beak.',
    text: 'CONDOR OBSERVATORY · NIGHT LOG · 23:44\nObject acquired 23:41, mag -9, green. Track steady 248°.\n23:44:06 — the track BENT. Eleven degrees left, then level.\nNote for the paper: rocks do not steer. — P.C.',
  },
};

/** Every CAST key a line may use, for the lint. */
export const CAST_IDS = Object.keys(CAST);

/** A line by id, or null. */
export function line(id) {
  return LINES[id] || null;
}

/** The chapter number a line id belongs to ('c1-…' → 1), or 0. */
export function chapterOfLine(id) {
  const m = /^c(\d+)-/.exec(id);
  return m ? Number(m[1]) : 0;
}

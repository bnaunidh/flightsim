/**
 * Names for the World Map's generated islands.
 *
 * Generic word lists, by climate band, two words each: "Gull Cay", whose
 * airfield answers the radio as "Gull Unicom". Nothing here is a real place,
 * and a deny-list keeps it that way — a cay that came out as "Midway" or
 * "Bermuda", or a strip called "Heathrow", would read as the real thing (and
 * world-cells.mjs fails the build if any name or word is on it).
 *
 * Codes are four letters starting X. No ICAO region uses an X prefix, so a
 * fictional field can never clash with a real one; world-layout.mjs checks
 * every code in the Island Sea is unique, the nine maps' included.
 *
 * Pure, node-safe, deterministic.
 */

/** The first word, by band: birds, shore things, weather. */
export const FIRST = Object.freeze({
  tropical: [
    'Gull', 'Tern', 'Frigate', 'Booby', 'Conch', 'Mangrove', 'Coconut', 'Parrot', 'Lime', 'Driftwood',
    'Sunfish', 'Starfish', 'Palm', 'Shell', 'Lagoon', 'Coral', 'Kingfisher', 'Egret', 'Hibiscus', 'Sandpiper',
  ],
  temperate: [
    'Heron', 'Gannet', 'Kittiwake', 'Cormorant', 'Oyster', 'Bramble', 'Linnet', 'Plover', 'Shingle', 'Thrift',
    'Samphire', 'Curlew', 'Wren', 'Seal', 'Otter', 'Lantern', 'Beacon', 'Clover', 'Saltmarsh', 'Dunlin',
  ],
  cold: [
    'Skua', 'Fulmar', 'Eider', 'Guillemot', 'Storm', 'Frost', 'Grey', 'Raven', 'Petrel', 'Shearwater',
    'Lichen', 'Ptarmigan', 'Tundra', 'Wolf', 'Stonechat', 'Merlin', 'Kelp', 'Haar', 'Brant', 'Snipe',
  ],
  ice: [
    'Ice', 'Floe', 'Snowy', 'Glacier', 'Rime', 'Narwhal', 'Walrus', 'Aurora', 'Polar', 'Hoarfrost',
  ],
});

/** The second word, by band. */
export const SECOND = Object.freeze({
  tropical: ['Cay', 'Isle', 'Island', 'Reef', 'Atoll'],
  temperate: ['Island', 'Isle', 'Holm', 'Rock', 'Point'],
  cold: ['Skerry', 'Holm', 'Rock', 'Island', 'Head'],
  ice: ['Rock', 'Skerry', 'Island'],
});

/**
 * Well-known real islands, archipelagos and airports (and their common short
 * names). A generated name may not BE one of these, CONTAIN one as a word,
 * or use one as either word. Lower case; compared word by word and whole.
 */
export const DENY = Object.freeze([
  // Pacific
  'hawaii', 'oahu', 'maui', 'kauai', 'molokai', 'lanai', 'niihau', 'midway', 'wake', 'guam', 'saipan', 'tinian',
  'iwo jima', 'okinawa', 'kiritimati', 'christmas', 'easter', 'rapa nui', 'pitcairn', 'tahiti', 'bora bora', 'moorea',
  'fiji', 'samoa', 'tonga', 'nauru', 'palau', 'yap', 'kwajalein', 'bikini', 'enewetak', 'johnston', 'palmyra', 'howland',
  'baker', 'jarvis', 'aleutian', 'kodiak', 'attu', 'adak', 'galapagos', 'clipperton', 'norfolk', 'lord howe', 'tasmania',
  'honshu', 'hokkaido', 'kyushu', 'shikoku', 'sakhalin', 'kuril', 'taiwan', 'hainan', 'luzon', 'borneo', 'java', 'bali',
  'sumatra', 'lombok', 'phuket', 'boracay', 'palawan', 'cebu',
  // Atlantic, Caribbean, Mediterranean, Indian Ocean, North Sea
  'bermuda', 'bahamas', 'nassau', 'jamaica', 'cuba', 'barbados', 'aruba', 'curacao', 'bonaire', 'antigua', 'barbuda',
  'saba', 'nevis', 'tortola', 'anguilla', 'montserrat', 'grenada', 'tobago', 'trinidad', 'martinique', 'guadeloupe',
  'key west', 'key largo', 'nantucket', 'martha', 'manhattan', 'staten', 'ellis', 'alcatraz', 'catalina',
  'iceland', 'greenland', 'faroe', 'shetland', 'orkney', 'skye', 'mull', 'iona', 'lewis', 'harris', 'barra', 'islay',
  'jersey', 'guernsey', 'alderney', 'sark', 'wight', 'man', 'lundy', 'scilly', 'anglesey', 'rockall', 'heligoland',
  'malta', 'gozo', 'sicily', 'sardinia', 'corsica', 'capri', 'ischia', 'elba', 'crete', 'rhodes', 'santorini', 'mykonos',
  'corfu', 'cyprus', 'ibiza', 'majorca', 'mallorca', 'menorca', 'tenerife', 'madeira', 'azores', 'canary', 'canaries',
  'st helena', 'helena', 'ascension', 'tristan', 'falkland', 'falklands', 'zanzibar', 'madagascar', 'mauritius',
  'seychelles', 'maldives', 'diego garcia', 'socotra', 'reunion', 'sri lanka', 'andaman', 'nicobar', 'lakshadweep',
  'gibraltar', 'svalbard', 'spitsbergen', 'jan mayen', 'bear',
  // Airports, and the names people use for them
  'heathrow', 'gatwick', 'stansted', 'luton', 'kennedy', 'jfk', 'laguardia', 'newark', 'logan', 'dulles', 'reagan',
  'hare', 'o\'hare', 'midway', 'lax', 'sfo', 'narita', 'haneda', 'kansai', 'changi', 'schiphol', 'orly', 'gaulle',
  'frankfurt', 'dubai', 'heathrow', 'incheon', 'chek lap kok', 'kai tak', 'lukla', 'courchevel', 'juliana', 'funchal',
  'barra', 'gibraltar', 'sydney', 'kingsford', 'auckland', 'honolulu', 'inouye', 'kahului', 'lihue', 'hilo', 'kona',
  'anchorage', 'sea-tac', 'seatac', 'hartsfield', 'pearson', 'indira', 'chhatrapati', 'shivaji', 'hamad', 'ataturk',
]);

const DENY_SET = new Set(DENY);

/** True when a name is, contains, or uses as a word something on the deny-list. */
export function isDenied(name) {
  const n = String(name || '').toLowerCase().trim();
  if (!n) return false;
  if (DENY_SET.has(n)) return true;
  const words = n.split(/[\s-]+/);
  for (const w of words) if (DENY_SET.has(w)) return true;
  for (let k = 0; k + 1 < words.length; k++) if (DENY_SET.has(`${words[k]} ${words[k + 1]}`)) return true;
  return false;
}

/** The word lists for a climate band (tropical / temperate / cold / ice), never undefined. */
function listsFor(band) {
  return { first: FIRST[band] || FIRST.temperate, second: SECOND[band] || SECOND.temperate };
}

/**
 * A name for a cell, from a 0..1 seed and its band. `taken` is a Set of names
 * already handed out; the next free combination is used, so a name is never
 * given twice in one sea. Returns { name, first, second }.
 */
export function makeName(seed, band, taken = new Set()) {
  const { first, second } = listsFor(band);
  const n = first.length * second.length;
  const start = Math.floor(Math.max(0, Math.min(0.999999, seed)) * n);
  for (let k = 0; k < n; k++) {
    const idx = (start + k * 7) % n;
    const f = first[idx % first.length];
    const s = second[Math.floor(idx / first.length) % second.length];
    const name = `${f} ${s}`;
    if (taken.has(name) || isDenied(name)) continue;
    return { name, first: f, second: s };
  }
  // Every combination used: number them. Never reached in Phase 1 (28 cells).
  return { name: `${first[start % first.length]} ${second[0]} ${taken.size + 1}`, first: first[start % first.length], second: second[0] };
}

/** The radio name of a cell's field: the first word, as "Gull Unicom". */
export function unicomName(nameObj) {
  return `${nameObj.first} Unicom`;
}

/**
 * A four-letter X code from a name: X + the first three letters of the first
 * word, then other letters of the name if that is taken. `taken` is a Set.
 */
export function makeCode(name, taken = new Set()) {
  const letters = String(name).toUpperCase().replace(/[^A-Z]/g, '');
  const w = String(name).toUpperCase().split(/\s+/).map((x) => x.replace(/[^A-Z]/g, '')).filter(Boolean);
  const tries = [];
  if (w[0]) tries.push(`X${w[0].slice(0, 3)}`);
  if (w[0] && w[1]) tries.push(`X${w[0].slice(0, 2)}${w[1][0]}`, `X${w[0][0]}${w[1].slice(0, 2)}`);
  for (let a = 1; a < letters.length; a++) {
    for (let b = a + 1; b < letters.length; b++) tries.push(`X${letters[0]}${letters[a]}${letters[b]}`);
  }
  for (const t of tries) if (t.length === 4 && !taken.has(t)) return t;
  for (let k = 0; k < 26 * 26; k++) {
    const t = `X${letters[0] || 'Q'}${String.fromCharCode(65 + Math.floor(k / 26))}${String.fromCharCode(65 + (k % 26))}`;
    if (!taken.has(t)) return t;
  }
  return 'XXXX';
}

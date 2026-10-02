/**
 * Multiplayer: everything that is just data.
 *
 * No DOM, no three.js, no network — the numbers and the wire format, so the
 * node tests can check every one of them without a browser. What lives here:
 *
 *   - the limits the class asked for: five server slots per Wi-Fi, five
 *     players per server (the host and four friends);
 *   - the peer ids those slots and join codes are claimed under;
 *   - names: call signs built from word lists ("Brave Otter 7"), server
 *     names built the same way ("Harbour Hangar"), and join codes too
 *     ("maple-kite-42"), because there is no free text in this game at all —
 *     nothing a child types, and no letters a host picks, is shown to anybody;
 *   - the quick-chat presets, which are the only chat there is;
 *   - the 15 Hz state snapshot, quantised into ~52 bytes;
 *   - the reliable events, and the checks that stop a malformed one from
 *     reaching the game.
 */

import { MAPS } from '../../world/maps.js';

/**
 * Bumped when the wire format changes. A mismatched pair refuses politely.
 * 2: lobbies, eight players, ranks. 3: bundled snapshots from the host, game
 * events and shared state (events.js), private matches. 4: the walking pilot
 * rides on the snapshot (a 19-byte tail while you are out on foot, below).
 */
export const PROTO = 4;

/** The five server slots on one network. Minecraft's LAN list, but capped. */
export const SLOT_COUNT = 5;
/** Host plus four, on a server a player made (the older LAN list). A sixth is told the server is full. */
export const MAX_PLAYERS = 5;

/*
 * Lobbies: five on every network, always there, all public, eight players
 * each. Nobody makes one, names one, locks one or hides one — the first
 * player into an empty lobby quietly hosts it (a browser tab cannot listen,
 * so somebody's tab has to be the server), and when that player goes the
 * lobby re-forms round whoever joined next (see lobby.js). The names are
 * fixed, from the server-name lists, so nothing about a lobby is ever text
 * somebody sent.
 */
export const LOBBY_COUNT = 5;
/** Eight to a lobby, the host included. A ninth is told it is full and shown the emptiest other one. */
export const LOBBY_MAX = 8;
/** A game joined by code: a friend on another network. Eight, like a lobby. */
export const CODE_GAME_MAX = 8;
/** Player numbers are 0 to 7: nobody's game has more than eight in it. */
export const PLAYER_IDS = 8;
export const LOBBY_NAMES = Object.freeze(['Sunny Airfield', 'Coral Cove', 'Cloud Base', 'Maple Runway', 'Harbour Hangar']);
/*
 * List 3 ("different lobbies have different maps"): every lobby is on its
 * own island, always the same one, and joining takes you there. An empty
 * lobby no longer starts on whatever island its first player had picked on
 * the menu — so the card can say where it is before anybody is in it. Five
 * islands with room for a crowd and something to fly round: the home
 * island (which also has a helipad, a harbour and roads, so all four rides
 * fit), the reef chain, the fjord, the volcano and the big airport.
 */
export const LOBBY_MAPS = Object.freeze(['kestrel', 'atoll', 'fjord', 'ember', 'gateway']);

/*
 * WORLD LOBBIES (list 3: "make the multiplayer go BEYOND lan", "palo alto
 * to berkeley"): five more, the same for everybody on the internet — not
 * derived from the network's address, so a player in one town and a player
 * in another find the same five. Everything else is a Wi-Fi lobby's: eight
 * at most, usernames from the lists, quick chat only, nobody hosts on
 * purpose, the next in line takes over. They are found through the public
 * matchmaking server and connect the way a join by code does (link.js,
 * 'v4'). Their ids carry the wire version, so a stale copy of the game
 * somewhere in the world holds its own five and never locks a newer one out.
 */
export const WORLD_COUNT = 5;
export const WORLD_NAMES = Object.freeze(['Kestrel Skyport', 'Meadow Airstrip', 'Skyline Airport', 'Summit Lookout', 'Glacier Station']);
export const WORLD_MAPS = Object.freeze(['kestrel', 'meadow', 'gateway', 'condor', 'fjord']);

/** Snapshots per second each player sends. */
export const STATE_HZ = 15;

/*
 * List 2, part 2: bumping into each other is a rule for the whole game, shown
 * on the lobby card before anybody joins. A number on the wire, words from
 * this copy's own list on the screen.
 *
 *   0 'off'     ghosts — fly straight through each other (how it always was)
 *   1 'gentle'  gentle bumps: you bounce off each other, nobody crashes
 *   2 'pvp'     gentle bumps, and a real crash between two players who both
 *               have PvP switched ON — the default for the five lobbies
 */
export const BUMP_RULES = Object.freeze(['off', 'gentle', 'pvp']);
export const BUMP_DEFAULT = 2;
export const BUMP_LABEL = Object.freeze({
  off: 'No bumping — fly through each other',
  gentle: 'Gentle bumps — nobody crashes',
  pvp: 'Gentle bumps · crash in PvP',
});
export const BUMP_SHORT = Object.freeze({ off: 'No bumping', gentle: 'Gentle bumps', pvp: 'Bumps · PvP crash' });
/** A rule off the wire: its index, or the default for anything else. */
export function bumpRule(v) {
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 && n < BUMP_RULES.length ? n : BUMP_DEFAULT;
}

/* ------------------------------------------------------------------ */
/* Peer ids                                                            */
/* ------------------------------------------------------------------ */

/**
 * The five slots on a network are five fixed ids. Hosting claims the first
 * free one — the signaling server refuses an id that is already held, which is
 * the whole lock — and the server list asks all five who is there.
 */
export function slotId(netHash, n) {
  return `ifs-${netHash}-${n}`;
}

export function codeId(code) {
  return `ifs-code-${code}`;
}

/** Lobby n on a network: one fixed id, and the signaling server's "taken" is the only lock there is on who hosts it. */
export function lobbyId(netHash, n) {
  return `ifs-${netHash}-lobby-${n}`;
}

/*
 * Part 3b: the private matches' directory, for admins only. A private match
 * is on no list — its code is the only way in — but its host also holds one
 * of these ids, so an admin can find it and join without the code. Anybody
 * may ping them and learn what a lobby's pong says (numbers: how many, the
 * most, which island); nobody who is not an admin gets in through one
 * (HostSession, 'private'), and no code is ever in what they answer.
 */
export const PDIR_COUNT = 12;

export function pdirId(n) {
  return `ifs-pdir-${n}`;
}

/** Which directory place, if any, an id is. */
export function pdirOf(id) {
  const m = /^ifs-pdir-([1-9][0-9]?)$/.exec(String(id || ''));
  const n = m ? Number(m[1]) : 0;
  return n >= 1 && n <= PDIR_COUNT ? n : 0;
}

/** Which lobby, if any, an id is. */
export function lobbyOf(netHash, id) {
  const m = /^ifs-([0-9a-f]{12})-lobby-([1-9])$/.exec(String(id || ''));
  if (!m || m[1] !== netHash) return 0;
  const n = Number(m[2]);
  return n >= 1 && n <= LOBBY_COUNT ? n : 0;
}

/** "Lobby 3 · Cloud Base" — from this copy's own list, never from anything sent. */
export function lobbyName(n) {
  return Number.isInteger(n) && n >= 1 && n <= LOBBY_COUNT ? LOBBY_NAMES[n - 1] : 'A lobby';
}

/** The island lobby n is always on. */
export function lobbyMap(n) {
  return Number.isInteger(n) && n >= 1 && n <= LOBBY_COUNT ? LOBBY_MAPS[n - 1] : LOBBY_MAPS[0];
}

/** World lobby n: one id for everybody on the internet, and this version of the game's own. */
export function worldId(n) {
  return `ifs-world-${PROTO}-${n}`;
}

/** Which world lobby, if any, an id is — this version's only. */
export function worldOf(id) {
  const m = /^ifs-world-(\d{1,3})-([1-9])$/.exec(String(id || ''));
  if (!m || Number(m[1]) !== PROTO) return 0;
  const n = Number(m[2]);
  return n >= 1 && n <= WORLD_COUNT ? n : 0;
}

export function worldName(n) {
  return Number.isInteger(n) && n >= 1 && n <= WORLD_COUNT ? WORLD_NAMES[n - 1] : 'A world lobby';
}

export function worldMap(n) {
  return Number.isInteger(n) && n >= 1 && n <= WORLD_COUNT ? WORLD_MAPS[n - 1] : WORLD_MAPS[0];
}

/** "Lobby 3" or "World 3": what the screen and the badge call one. */
export function lobbyLabel(n, world = false) {
  return `${world ? 'World' : 'Lobby'} ${n}`;
}

/** A per-tab token a player sends with their hello, so a host can tell a player coming back from a new one. */
export function seatToken(rand = Math.random) {
  return randomToken(rand).slice(0, 16);
}

/** Which slot, if any, an id is. */
export function slotOf(netHash, id) {
  const m = /^ifs-([0-9a-f]{12})-([1-9])$/.exec(String(id || ''));
  if (!m || m[1] !== netHash) return 0;
  const n = Number(m[2]);
  return n >= 1 && n <= SLOT_COUNT ? n : 0;
}

/** A private id for a player who is only looking or joining. */
export function playerPeerId(rand = Math.random) {
  let s = '';
  const abc = 'abcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 14; i++) s += abc[Math.floor(rand() * abc.length) % abc.length];
  return `ifs-p-${s}`;
}

export function randomToken(rand = Math.random) {
  let s = '';
  const abc = 'abcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 20; i++) s += abc[Math.floor(rand() * abc.length) % abc.length];
  return s;
}

/* ------------------------------------------------------------------ */
/* "Same Wi-Fi"                                                        */
/* ------------------------------------------------------------------ */

/**
 * The address a trace endpoint reports, from its `ip=` line.
 * Returns the address string or null.
 */
export function parseTrace(text) {
  const m = /^ip=([0-9a-fA-F:.]+)\s*$/m.exec(String(text || ''));
  return m ? m[1] : null;
}

/**
 * What identifies the network, from the public address.
 *
 * IPv4 behind a school's NAT is one address for the whole building, which is
 * the point. IPv6 is not: every device gets its own, so hashing the whole
 * address would put every Chromebook on a network of one. The first four
 * groups are the network's own /64 and are shared by everything on it.
 */
export function networkKey(ip) {
  const s = String(ip || '').trim().toLowerCase();
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(s)) return s;
  if (!s.includes(':')) return null;
  // Expand the :: so the first four groups are really the first four.
  const [head, tail] = s.split('::');
  const h = head ? head.split(':') : [];
  const t = tail !== undefined && tail ? tail.split(':') : [];
  const fill = s.includes('::') ? Array(Math.max(0, 8 - h.length - t.length)).fill('0') : [];
  const groups = [...h, ...fill, ...t].map((g) => (g || '0').replace(/^0+(?=.)/, ''));
  if (groups.length < 4) return null;
  return `${groups.slice(0, 4).join(':')}::/64`;
}

/**
 * First twelve hex of SHA-256("island-flight-lan:" + ip). The raw address is
 * not put in a slot id — but the hash hides it only from a glance: the salt
 * is public and there are 2^32 IPv4 addresses, so anyone who sees a slot id
 * can find the address by trying them all, in minutes. Treat a slot id as
 * saying which network it is, because it does. (And the address itself is
 * what every website the tab visits sees anyway.)
 */
export function netHashFor(ip) {
  const key = networkKey(ip);
  if (!key) return null;
  return sha256Hex(`island-flight-lan:${key}`).slice(0, 12);
}

/*
 * SHA-256, written out.
 *
 * crypto.subtle only exists on https and localhost. The game is also meant to
 * be served straight off a Mac on a network with no internet — plain http on
 * 192.168.x.x — and there it is undefined. Sixty lines is cheaper than a
 * second code path.
 */
const K256 = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

export function sha256Hex(str) {
  const bytes = new TextEncoder().encode(String(str));
  const len = bytes.length;
  const total = Math.ceil((len + 9) / 64) * 64;
  const buf = new Uint8Array(total);
  buf.set(bytes);
  buf[len] = 0x80;
  const dv = new DataView(buf.buffer);
  const bits = len * 8;
  dv.setUint32(total - 4, bits >>> 0);
  dv.setUint32(total - 8, Math.floor(bits / 0x100000000));
  const H = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);
  const w = new Uint32Array(64);
  const rotr = (x, n) => (x >>> n) | (x << (32 - n));
  for (let off = 0; off < total; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = dv.getUint32(off + i * 4);
    for (let i = 16; i < 64; i++) {
      const a = w[i - 15];
      const b = w[i - 2];
      const s0 = rotr(a, 7) ^ rotr(a, 18) ^ (a >>> 3);
      const s1 = rotr(b, 17) ^ rotr(b, 19) ^ (b >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = H;
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + K256[i] + w[i]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + t1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) >>> 0;
    }
    H[0] += a; H[1] += b; H[2] += c; H[3] += d;
    H[4] += e; H[5] += f; H[6] += g; H[7] += h;
  }
  return Array.from(H, (x) => x.toString(16).padStart(8, '0')).join('');
}

/* ------------------------------------------------------------------ */
/* Names: call signs, built from lists                                 */
/* ------------------------------------------------------------------ */

/*
 * Nothing a child types is shown to anybody else.
 *
 * The first three versions let a child type a name and put it through a
 * word filter, and each was beaten in review: stars and spaces, compounds,
 * small capitals, upside-down text, and last of all look-alike letters from
 * other alphabets and non-ASCII digits in place of i and l — 88 of 88 got
 * through, end to end over the real server. A filter is a list of what to
 * catch, and there is always one more way to spell a word.
 *
 * So a player's name is a CALL SIGN: an adjective and an animal (or an
 * aircraft word) from the two lists below, and optionally a number —
 * "Brave Otter", "Swift Falcon 7". A server's name is a place and a base
 * from two more lists — "Harbour Hangar", "Cloud Base". The screen has a
 * dice and pickers, and no text box. Every name that crosses the wire is
 * parsed against the lists, and anything that is not exactly
 *
 *     list-word ' ' list-word [' ' number]
 *
 * — in plain ASCII, one space, the words spelt as they are here — is thrown
 * away and replaced. A modified client can send whatever it likes; what
 * everybody else sees can only ever be words from these lists.
 *
 * The lists were read pair by pair, all of them, for anything two words make
 * together: an idiom, a nickname, a slur, a joke a teacher would know.
 * Left out on purpose — animals that are playground insults or slurs (pig,
 * cow, donkey, rat, snake, monkey and the other apes, frog, chicken, goose,
 * turkey, hippo, whale, sloth, weasel, skunk, rabbit, beaver, cougar, fox,
 * wolf, bear, dog, cat and kitten); birds with a second meaning (tit, booby,
 * cock and every -cock, shag, swallow, duck, owl, magpie, gannet, heron,
 * kiwi); sea animals that are insults or innuendo (starfish, jellyfish,
 * manatee, crab); cheetah ("cheater"); chopper, bomber, fighter, blimp and
 * cruiser; and adjectives about bodies, looks, brains or moods (big, tiny,
 * fat, hot, wet, hard, sweet, cheeky, naughty, crazy, silly, sleepy, smelly,
 * foxy, fruity, frisky, perky, and whizzy and twinkly for what is inside
 * them), colours that are about people (black,
 * white, brown, yellow, red), and the words that make an idiom with an
 * animal that is here (magic dragon, silver fox, blue whale, grand wizard,
 * proud boys, eager beaver). The numbers leave out every number from 1 to
 * 99 that the ADL's database lists as a hate symbol on its own — 12, 13, 14,
 * 18, 23, 28, 33, 38, 43, 83 and 88, read off its "Hate on Display" edition
 * entry by entry (the rest of its numbers have three or four digits, or are
 * two numbers joined by a slash or a hyphen, or carry a percent sign; its
 * entry for 12 mentions 1 and 2 used apart, and those stay, since "Swift
 * Falcon 2" is also how a second Swift Falcon is told apart) — and 69.
 *
 * USERNAMES. With lobbies a child chooses their username from these lists,
 * so they grew: 191 adjectives and 231 nouns, 44,121 pairs — more birds and
 * sea animals, dinosaurs, story creatures, aircraft and the people who fly
 * them, space, weather and a few treats. Every new word was read on its own
 * and against the whole other list, by the same rules, and these were left
 * out as well: hornet (it contains a rude word run together), hydra ("Hail
 * Hydra"), cadet ("space cadet"), positive ("tested positive"), ninja (used
 * online to get round a slur filter), troll, fairy, ogre, giant, gnome,
 * goblin, clown, nerd and geek (playground names), helicopter (a transphobic
 * meme), raccoon (a slur inside it), woodpecker, cockatoo, cockatiel,
 * peacock and chickadee (what is inside them), bunny, pup, cub, stallion,
 * camel and kingfisher (a beer); food that is a slur for a people (coconut,
 * oreo, banana, twinkie, apple, egg, potato), innuendo (peach, cherry,
 * melon, nuts, sausage, taco, muffin, cupcake, cookie, fudge, candy, honey,
 * lollipop, pizza) or a body joke (marshmallow, pancake, dumpling, pudding);
 * snowflake, storm, rainbow and wasp; and adjectives that are a mood, a
 * look or a dare (magic, grand, proud, space, fierce, fabulous, zesty,
 * quirky, wacky, nutty, dizzy, spicy, juicy, salty, chunky, cuddly, sturdy,
 * quiet, fast, wild, hyper, strong, spotty). BANNED_PAIRS below lists the
 * idioms by name; none can be made from the lists, and the node test reads
 * every pair against the old word filter as a mechanical second pass.
 */
export const CALLSIGN_ADJECTIVES = Object.freeze([
  // The first 66, from the call-sign review.
  'Brave', 'Breezy', 'Bright', 'Bubbly', 'Calm', 'Cheerful', 'Chipper', 'Chirpy', 'Clever', 'Cosmic',
  'Cosy', 'Curious', 'Dapper', 'Daring', 'Dazzling', 'Eager', 'Epic', 'Fearless', 'Fluffy', 'Friendly',
  'Frosty', 'Fuzzy', 'Gentle', 'Giggly', 'Glowing', 'Golden', 'Groovy', 'Happy', 'Heroic', 'Honest',
  'Jazzy', 'Jolly', 'Joyful', 'Keen', 'Kind', 'Lively', 'Loyal', 'Lucky', 'Merry', 'Mighty',
  'Nimble', 'Noble', 'Peppy', 'Plucky', 'Polite', 'Quick', 'Radiant', 'Rapid', 'Smiley', 'Snappy',
  'Snazzy', 'Snowy', 'Sparkly', 'Speedy', 'Starry', 'Steady', 'Stellar', 'Sunny', 'Super', 'Swift',
  'Trusty', 'Valiant', 'Wise', 'Witty', 'Zany', 'Zippy',
  // And the rest, for the username picker: about kindness, pluck, speed, flying, space and weather.
  'Adventurous', 'Airborne', 'Amazing', 'Arctic', 'Astral', 'Awesome', 'Blissful', 'Bold', 'Brainy', 'Brilliant',
  'Busy', 'Buzzy', 'Capable', 'Carefree', 'Caring', 'Charming', 'Cheery', 'Chilly', 'Comfy', 'Confident',
  'Cool', 'Courageous', 'Creative', 'Dashing', 'Dauntless', 'Dependable', 'Determined', 'Dynamic', 'Electric', 'Energetic',
  'Excellent', 'Faithful', 'Famous', 'Fantastic', 'Festive', 'Flying', 'Galactic', 'Gallant', 'Generous', 'Glad',
  'Gleaming', 'Glorious', 'Graceful', 'Grateful', 'Great', 'Helpful', 'Hopeful', 'Humble', 'Incredible', 'Inventive',
  'Jaunty', 'Jubilant', 'Legendary', 'Luminous', 'Majestic', 'Marvellous', 'Mega', 'Mindful', 'Modest', 'Musical',
  'Mysterious', 'Nifty', 'Optimistic', 'Orbital', 'Patient', 'Peaceful', 'Playful', 'Polar', 'Powerful',
  'Precise', 'Racing', 'Rainy', 'Ready', 'Regal', 'Resolute', 'Roving', 'Royal', 'Savvy', 'Sensible',
  'Serene', 'Sharp', 'Shimmering', 'Shiny', 'Silver', 'Sincere', 'Skilful', 'Skyward', 'Smart', 'Snug',
  'Soaring', 'Solar', 'Sonic', 'Sparkling', 'Spirited', 'Splendid', 'Sporty', 'Spry', 'Stalwart', 'Starlit',
  'Sunlit', 'Superb', 'Supersonic', 'Swooping', 'Terrific', 'Thoughtful', 'Thrilling', 'Tidy', 'Tiptop', 'Tireless',
  'Tremendous', 'Triumphant', 'Tropical', 'Turbo', 'Unstoppable', 'Upbeat', 'Vibrant', 'Victorious', 'Vivid', 'Wandering',
  'Warm', 'Whirling', 'Whistling', 'Wonderful', 'Wondrous', 'Zooming',
]);
export const CALLSIGN_NOUNS = Object.freeze([
  // Birds
  'Albatross', 'Bluebird', 'Cardinal', 'Condor', 'Crane', 'Dove', 'Eagle', 'Emu', 'Falcon', 'Finch',
  'Flamingo', 'Goldfinch', 'Harrier', 'Hawk', 'Hummingbird', 'Kestrel', 'Kookaburra', 'Lark', 'Macaw', 'Merlin',
  'Nightingale', 'Oriole', 'Osprey', 'Parakeet', 'Parrot', 'Pelican', 'Penguin', 'Puffin', 'Roadrunner', 'Robin',
  'Skylark', 'Sparrow', 'Stork', 'Swan', 'Toucan', 'Wren',
  // From the sea
  'Beluga', 'Dolphin', 'Marlin', 'Narwhal', 'Nautilus', 'Octopus', 'Orca', 'Otter', 'Seahorse', 'Seal',
  'Shark', 'Stingray', 'Swordfish', 'Turtle',
  // From the land
  'Aardvark', 'Alpaca', 'Anteater', 'Antelope', 'Armadillo', 'Axolotl', 'Badger', 'Beetle', 'Bison', 'Bumblebee',
  'Butterfly', 'Caribou', 'Caterpillar', 'Chinchilla', 'Dragonfly', 'Elk', 'Firefly', 'Gazelle', 'Gecko', 'Giraffe',
  'Grasshopper', 'Hamster', 'Hedgehog', 'Honeybee', 'Iguana', 'Impala', 'Jaguar', 'Kangaroo', 'Koala', 'Ladybird',
  'Lemur', 'Leopard', 'Lion', 'Llama', 'Lynx', 'Meerkat', 'Mongoose', 'Moose', 'Ocelot', 'Panda',
  'Panther', 'Platypus', 'Pony', 'Porcupine', 'Puma', 'Quokka', 'Reindeer', 'Rhino', 'Salamander', 'Squirrel',
  'Tiger', 'Wallaby', 'Wombat', 'Yak', 'Zebra',
  // Long ago
  'Diplodocus', 'Pterodactyl', 'Raptor', 'Stegosaurus', 'Triceratops',
  // From stories
  'Centaur', 'Dragon', 'Elf', 'Genie', 'Griffin', 'Knight', 'Kraken', 'Mermaid', 'Pegasus',
  'Phoenix', 'Pirate', 'Pixie', 'Robot', 'Sphinx', 'Superhero', 'Unicorn', 'Viking', 'Yeti',
  // From the sky
  'Airliner', 'Airship', 'Autogyro', 'Balloon', 'Biplane', 'Concorde', 'Dirigible', 'Floatplane', 'Glider', 'Gyrocopter',
  'Hovercraft', 'Jet', 'Jetpack', 'Kite', 'Monoplane', 'Mustang', 'Parachute', 'Paraglider', 'Propeller',
  'Rocket', 'Seaplane', 'Skyhook', 'Spitfire', 'Triplane', 'Zeppelin',
  // Who flies them
  'Adventurer', 'Aviator', 'Captain', 'Explorer', 'Navigator', 'Pilot', 'Pioneer', 'Ranger', 'Skipper',
  'Stargazer', 'Trailblazer', 'Voyager', 'Wingman',
  // From space
  'Astronaut', 'Comet', 'Cosmonaut', 'Eclipse', 'Galaxy', 'Jupiter', 'Lander', 'Mars', 'Mercury', 'Meteor',
  'Nebula', 'Neptune', 'Orbit', 'Planet', 'Pluto', 'Pulsar', 'Quasar', 'Rover', 'Satellite', 'Saturn',
  'Shuttle', 'Spaceship', 'Stardust', 'Starship', 'Supernova',
  // Weather
  'Breeze', 'Cloud', 'Drizzle', 'Frost', 'Icicle', 'Lightning', 'Moonbeam', 'Raindrop', 'Starlight', 'Sunbeam',
  'Sunrise', 'Sunset', 'Sunshine', 'Thunder', 'Twilight', 'Whirlwind',
  // Treats
  'Biscuit', 'Gumdrop', 'Jellybean', 'Lemonade', 'Noodle', 'Popcorn', 'Popsicle', 'Pretzel', 'Smoothie', 'Sundae',
  'Toffee', 'Waffle',
  // Things that go and things that help
  'Anchor', 'Boomerang', 'Compass', 'Kayak', 'Lantern', 'Lighthouse', 'Pinwheel', 'Sailboat', 'Scooter', 'Submarine',
  'Telescope', 'Tugboat',
]);
/** Server names: a place, and where aeroplanes (or boats, or cars) gather there. */
export const SERVER_PLACES = Object.freeze([
  'Acorn', 'Bluebird', 'Breezy', 'Canyon', 'Cedar', 'Cloud', 'Comet', 'Coral', 'Driftwood', 'Emerald',
  'Glacier', 'Golden', 'Harbour', 'Hilltop', 'Island', 'Jetstream', 'Kestrel', 'Lagoon', 'Lighthouse', 'Maple',
  'Meadow', 'Misty', 'Moonbeam', 'Ocean', 'Orchard', 'Palm', 'Pebble', 'Pine', 'Puffin', 'Riverside',
  'Rocket', 'Sandy', 'Seashell', 'Seaside', 'Skyline', 'Snowy', 'Starlight', 'Summit', 'Sunny', 'Sunrise',
  'Sunset', 'Thunder', 'Tropical', 'Valley', 'Willow', 'Windy',
]);
export const SERVER_BASES = Object.freeze([
  'Airfield', 'Airport', 'Airstrip', 'Base', 'Bay', 'Camp', 'Club', 'Cove', 'Crew', 'Dock',
  'Hangar', 'Landing', 'Lookout', 'Marina', 'Outpost', 'Patrol', 'Pier', 'Point', 'Runway', 'Skyport',
  'Squadron', 'Station', 'Tower',
]);
/** The numbers a call sign may end in: 1 to 99, less these. */
export const NOT_NUMBERS = Object.freeze([12, 13, 14, 18, 23, 28, 33, 38, 43, 69, 83, 88]);

/** Longest call sign ("Adventurous Hummingbird 99" is 26) and server name ("Lighthouse Squadron" is 19). */
export const NAME_MAX = 26;
export const SERVER_NAME_MAX = 24;

const ADJ = new Set(CALLSIGN_ADJECTIVES);
const NOUN = new Set(CALLSIGN_NOUNS);
const PLACE = new Set(SERVER_PLACES);
const BASE = new Set(SERVER_BASES);
const NOT_NUM = new Set(NOT_NUMBERS);

/*
 * Idioms, nicknames and worse that two words can make together. None of these
 * can be made from the lists above — each was left out by leaving a word out
 * (see the comment on the lists) — and they are refused here as well, so a
 * word added one day cannot quietly make one. The node test checks that none
 * of them parses, and reads every pair the lists make against the old word
 * filter as a mechanical second pass. ROT13'd, so this file does not read
 * like a playground wall.
 */
const BANNED_PAIRS_R13 = [
  'Zntvp Qentba', 'Fvyire Sbk', 'Oyhr Junyr', 'Rntre Ornire', 'Jvfr Bjy', 'Tenaq Jvmneq', 'Vzcrevny Jvmneq',
  'Tenaq Qentba', 'Cebhq Obl', 'Tbyqra Fubjre', 'Fcnpr Pnqrg', 'Pbfzvp Pnqrg', 'Fbttl Ovfphvg', 'Yvzc Abbqyr',
  'Jrg Abbqyr', 'Unccl Raqvat', 'Yhpxl Fgevxr', 'Wbyyl Ebtre', 'Unvy Ulqen', 'Oyhr Snypba', 'Fabj Ohaal',
  'Fabjl Ohaal', 'Fubj Cbal', 'Cnegl Navzny', 'Oynpx Cnagure', 'Cvax Cnagure', 'Juvgr Xavtug', 'Ybna Funex',
  'Cbby Funex', 'Pneq Funex', 'Ubg Qbt', 'Gbc Qbt', 'Pbby Png', 'Rneyl Oveq', 'Avtug Bjy', 'Ybar Jbys', 'Qnex Ubefr',
  'Pbyq Ghexrl', 'Fvyyl Tbbfr', 'Bqq Qhpx', 'Yhpxl Qhpx', 'Ohfl Ornire', 'Veba Pebff', 'Tbyqra Qnja', 'Oynpx Fha',
  'Unccl Zrepunag', 'Aboyr Fnintr', 'Fcrrql Tbamnyrf', 'Zvtugl Juvgrl', 'Checyr Unmr', 'Zntvp Zhfuebbz',
  'Jnaqrevat Wrj', 'Fabjl Fabjsynxr', 'Sebfgl Fabjsynxr', 'Sylvat Cvt', 'Tbyqra Oebja', 'Oebja Fhtne',
  'Zryybj Lryybj', 'Fhtne Qnqql', 'Puvyyl Jvyyl', 'Syhssl Znefuznyybj', 'Unccl Ubhe', 'Pelfgny Zrgu',
  'Pbfzvp Oebjavr', 'Ebpxrg Shry', 'Sylvat Uvtu', 'Cnegl Cbbcre', 'Fzneg Nyrp', 'Pncgnva Boivbhf', 'Qenzn Dhrra',
  'Vpr Dhrra',
];
const rot13 = (x) => x.replace(/[a-z]/gi, (c) => { const b = c <= 'Z' ? 65 : 97; return String.fromCharCode(((c.charCodeAt(0) - b + 13) % 26) + b); });
export const BANNED_PAIRS = Object.freeze(BANNED_PAIRS_R13.map(rot13));
const BANNED = new Set(BANNED_PAIRS);

/** Every number a call sign may carry, in order. */
export const CALLSIGN_NUMBERS = Object.freeze(Array.from({ length: 99 }, (_, i) => i + 1).filter((n) => !NOT_NUM.has(n)));

/*
 * Two words and maybe a number, in plain ASCII — no /u and no /i, so [A-Z]
 * and [0-9] are exactly those characters and nothing that looks like them;
 * and in JavaScript $ is the end of the string, not a line.
 */
const CALLSIGN_RE = /^([A-Z][a-z]{1,11}) ([A-Z][a-z]{1,11})(?: ([1-9][0-9]?))?$/;
const SERVER_RE = /^([A-Z][a-z]{1,11}) ([A-Z][a-z]{1,11})$/;

/**
 * A call sign, taken apart — or null for anything that is not exactly one:
 * { adjective, noun, number } with number 0 for none.
 */
export function parseCallSign(raw) {
  if (typeof raw !== 'string' || raw.length > NAME_MAX) return null;
  const m = CALLSIGN_RE.exec(raw);
  if (!m || !ADJ.has(m[1]) || !NOUN.has(m[2]) || BANNED.has(`${m[1]} ${m[2]}`)) return null;
  const number = m[3] ? Number(m[3]) : 0;
  if (number && NOT_NUM.has(number)) return null;
  return { adjective: m[1], noun: m[2], number };
}

export function formatCallSign({ adjective, noun, number = 0 }) {
  return number ? `${adjective} ${noun} ${number}` : `${adjective} ${noun}`;
}

const pick = (list, rand) => list[Math.floor(rand() * list.length) % list.length];

/** A new call sign, for the dice. Half of them with a number. */
export function randomCallSign(rand = Math.random) {
  for (let i = 0; i < 20; i++) {
    const adjective = pick(CALLSIGN_ADJECTIVES, rand);
    const noun = pick(CALLSIGN_NOUNS, rand);
    const number = rand() < 0.5 ? pick(CALLSIGN_NUMBERS, rand) : 0;
    const s = formatCallSign({ adjective, noun, number });
    if (parseCallSign(s)) return s;
  }
  return 'Brave Otter';
}

/**
 * The call sign the host gives a player whose own did not parse: from their
 * number in the game, so it is the same every time and different for each.
 */
export function callSignForId(id) {
  const n = Math.abs(Number(id) | 0);
  return formatCallSign({
    adjective: CALLSIGN_ADJECTIVES[(n * 17 + 5) % CALLSIGN_ADJECTIVES.length],
    noun: CALLSIGN_NOUNS[(n * 29 + 3) % CALLSIGN_NOUNS.length],
  });
}

/**
 * Whether a name may be shown to other players: { name, ok, why }, where
 * why is 'empty' or 'list' (not built from the lists). Nothing is cleaned —
 * not a space trimmed, not a letter folded — because a name either came from
 * the pickers exactly or it did not come from them.
 */
export function cleanName(raw) {
  if (raw == null || raw === '') return { name: '', ok: false, why: 'empty' };
  return parseCallSign(raw) ? { name: raw, ok: true, why: null } : { name: '', ok: false, why: 'list' };
}

/** A name somebody else sent, as it may be shown: theirs if it parses, the fallback call sign if not. */
export function safeName(raw, fallback) {
  if (parseCallSign(raw)) return raw;
  return parseCallSign(fallback) ? fallback : callSignForId(0);
}

/** Two players who both picked Swift Falcon become Swift Falcon and Swift Falcon 2. */
export function uniqueName(name, taken) {
  const have = new Set([...taken].map(String));
  if (!have.has(name)) return name;
  const p = parseCallSign(name);
  if (!p) return name;
  for (const n of CALLSIGN_NUMBERS) {
    if (n < 2) continue;
    const cand = formatCallSign({ ...p, number: n });
    if (!have.has(cand)) return cand;
  }
  return name;
}

/** A server name, taken apart — or null for anything that is not exactly place + ' ' + base. */
export function parseServerName(raw) {
  if (typeof raw !== 'string' || raw.length > SERVER_NAME_MAX) return null;
  const m = SERVER_RE.exec(raw);
  if (!m || !PLACE.has(m[1]) || !BASE.has(m[2])) return null;
  return { place: m[1], base: m[2] };
}

/** A server name somebody else sent, as it may be shown. */
export function safeServerName(raw, fallback = 'A server') {
  return parseServerName(raw) ? raw : fallback;
}

/** A new server name, for the dice. */
export function randomServerName(rand = Math.random) {
  return `${pick(SERVER_PLACES, rand)} ${pick(SERVER_BASES, rand)}`;
}

/** The same server name every time for the same seed (a player's key). */
export function serverNameFor(seed) {
  let k = 0;
  for (const ch of String(seed || '')) k = (k * 31 + ch.charCodeAt(0)) >>> 0;
  return `${SERVER_PLACES[k % SERVER_PLACES.length]} ${SERVER_BASES[Math.floor(k / SERVER_PLACES.length) % SERVER_BASES.length]}`;
}

/* ------------------------------------------------------------------ */
/* Join codes: two list words and a number                             */
/* ------------------------------------------------------------------ */

/*
 * A join code is on screen for as long as its server is up — in the host's
 * toast and badge, and on every joiner's badge and player list — so it is
 * made the way names are: from lists, with no free letters in it anywhere.
 *
 * It was five letters. The first review got HELLO onto a joiner's badge from
 * a modified host, and found the alphabet could roll a word by chance. The
 * next version took out the vowels and refused a list of rude consonant
 * runs, and the review after that got a swear word and a slur through it,
 * spelt without vowels in ways the list had not thought of: from an honest
 * host's own dice about one code in five hundred, and from a modified host
 * whenever it liked. A list of runs to refuse is a word filter, and a word
 * filter always has one more spelling to miss. So a code is
 *
 *     first-second-number                                  maple-kite-42
 *
 * a word from CODE_FIRST (the outdoors: weather, sky, plants, water, land),
 * a word from CODE_SECOND (things: boats and aircraft, toys, music,
 * buildings) and a number from CALLSIGN_NUMBERS, so never a hate-symbol
 * number and never 69. 113 × 114 × 87 is 1.1 million codes, as many as the
 * letters had, and a code only exists while its server is up.
 *
 * All 12,882 pairs were checked for anything two words make together — an
 * idiom, a nickname, innuendo, a slur — from both sides: each first word
 * against the whole second list, and each second word against the whole
 * first list, as the call-sign lists were. Left out on purpose:
 * words that are first of all somebody's name (holly, ruby, jade, violet,
 * olive, iris, ivy, hazel, dawn, cliff), which a code would pin on a
 * classmate; colour words (the ones that are about people, blue and green
 * for what they make, amber for the alert); anything with a second meaning
 * about bodies, drugs (snow, ice, crystal, grass,
 * rock, stone, pot, dust, candy), drink or hate (storm, cross, wheel,
 * hammer, iron, torch, hood, crow, cotton, jungle, spade, cricket); food and
 * fruit, most of which is innuendo; weather that hurts people (tornado,
 * cyclone); words a child would type as another word when a code is read
 * out (sun, sail, plane, pier, peak, tide, fort, creek); and three that run
 * together with a word from the other list into a rude one: bamboo, aurora
 * and chalk. The node test checks every pair run together, every word, and
 * that each list stays in order with nothing twice.
 *
 * Three functions, one rule:
 *
 *   parseCode(x)      exactly first '-' second '-' number, in lower-case
 *                     ASCII, list words and a list number — or null;
 *   shownCode(x)      x itself if parseCode() takes it, and null for anything
 *                     else: the only way a code reaches a screen;
 *   normaliseCode(x)  what a child typed, in any case, with spaces or hyphens
 *                     or neither, as the code in exactly that form — spelt
 *                     from the lists' own strings, never from what was typed.
 */
export const CODE_FIRST = Object.freeze([
  'acorn', 'arctic', 'aspen', 'autumn', 'blizzard', 'blossom', 'bluebell', 'boulder', 'breeze', 'brook',
  'cactus', 'canyon', 'cedar', 'cloud', 'clover', 'coast', 'comet', 'coral', 'cosmos', 'cove',
  'delta', 'dewdrop', 'diamond', 'drizzle', 'dune', 'dusk', 'eclipse', 'elm', 'ember', 'emerald',
  'fern', 'field', 'forest', 'fountain', 'frost', 'galaxy', 'garden', 'grove', 'harvest', 'hill',
  'horizon', 'iceberg', 'island', 'jupiter', 'kelp', 'lagoon', 'lake', 'lava', 'lilac', 'lotus',
  'lunar', 'maple', 'marble', 'marigold', 'meadow', 'meteor', 'mint', 'mist', 'moon', 'moonbeam',
  'moss', 'mountain', 'nebula', 'neptune', 'nova', 'oak', 'oasis', 'ocean', 'opal', 'orbit',
  'orchard', 'orchid', 'palm', 'pebble', 'petal', 'pine', 'planet', 'pluto', 'polar', 'pond',
  'primrose', 'rain', 'raindrop', 'rapids', 'reef', 'ridge', 'ripple', 'river', 'saturn', 'shore',
  'silver', 'sky', 'solar', 'spark', 'spring', 'spruce', 'star', 'starlight', 'summer', 'summit',
  'sunbeam', 'sunflower', 'sunrise', 'sunset', 'thunder', 'tulip', 'twilight', 'valley', 'volcano', 'waterfall',
  'wave', 'willow', 'winter',
]);
export const CODE_SECOND = Object.freeze([
  'airship', 'anchor', 'antenna', 'arrow', 'atlas', 'backpack', 'badge', 'balloon', 'banjo', 'barn',
  'beacon', 'biplane', 'blanket', 'boat', 'boomerang', 'bridge', 'bucket', 'buggy', 'bus', 'cabin',
  'camera', 'candle', 'canoe', 'canvas', 'capsule', 'carnival', 'castle', 'circus', 'clock', 'compass',
  'cottage', 'crane', 'crayon', 'drum', 'engine', 'envelope', 'festival', 'flag', 'gadget', 'glider',
  'guitar', 'hammock', 'harp', 'hovercraft', 'igloo', 'jigsaw', 'kayak', 'kettle', 'keyboard', 'kite',
  'ladder', 'lander', 'lantern', 'library', 'lighthouse', 'magnet', 'map', 'marina', 'medal', 'mitten',
  'monorail', 'museum', 'notebook', 'paintbrush', 'palace', 'parade', 'parcel', 'pencil', 'piano', 'pinwheel',
  'postcard', 'propeller', 'puzzle', 'quilt', 'radar', 'radio', 'raft', 'ribbon', 'robot', 'rover',
  'rowboat', 'runway', 'sailboat', 'satellite', 'scooter', 'seaplane', 'seesaw', 'shuttle', 'skateboard', 'sketchbook',
  'sled', 'spaceship', 'stamp', 'station', 'sticker', 'submarine', 'surfboard', 'taxi', 'teacup', 'telescope',
  'tent', 'ticket', 'tower', 'tractor', 'train', 'treasure', 'treehouse', 'trophy', 'tugboat', 'umbrella',
  'violin', 'wagon', 'whistle', 'windmill',
]);
export const CODE_EXAMPLE = 'maple-kite-42';
/** The longest code ("sunflower-lighthouse-99" is 23), and the most anybody may type for one. */
export const CODE_MAX = 24;
export const CODE_TYPED_MAX = 40;

const CODE_A = new Set(CODE_FIRST);
const CODE_B = new Set(CODE_SECOND);
const CODE_NUM = new Set(CALLSIGN_NUMBERS);
/** Every pair run together, "maplekite", to its two words — how a code typed without spaces is read. */
const CODE_JOINED = new Map();
for (const first of CODE_FIRST) for (const second of CODE_SECOND) CODE_JOINED.set(first + second, { first, second });
/** How many ways the pairs run together: the node test checks it is every pair, so each is read one way only. */
export const CODE_JOINED_COUNT = CODE_JOINED.size;
/* Plain ASCII, as CALLSIGN_RE: no /u, no /i, and $ is the end of the string. */
const CODE_RE = /^([a-z]{2,12})-([a-z]{2,12})-([1-9][0-9]?)$/;

/** A code, taken apart — or null for anything that is not exactly one: { first, second, number }. */
export function parseCode(raw) {
  if (typeof raw !== 'string' || raw.length > CODE_MAX) return null;
  const m = CODE_RE.exec(raw);
  if (!m || !CODE_A.has(m[1]) || !CODE_B.has(m[2]) || !CODE_NUM.has(Number(m[3]))) return null;
  return { first: m[1], second: m[2], number: Number(m[3]) };
}

export function formatCode({ first, second, number }) {
  return `${first}-${second}-${number}`;
}

/** A new code: a word from each list and a number. Every one of them is a code parseCode() takes. */
export function makeCode(rand = Math.random) {
  return formatCode({ first: pick(CODE_FIRST, rand), second: pick(CODE_SECOND, rand), number: pick(CALLSIGN_NUMBERS, rand) });
}

/** A code as it may be shown: the string itself if it is exactly a code, and null for anything else. */
export function shownCode(raw) {
  return parseCode(raw) ? raw : null;
}

/**
 * Whatever was typed, as a code — or null if it cannot be one. Forgiving
 * about case, spaces and hyphens ("Maple Kite 42", "maplekite42"); strict
 * about everything else: ASCII letters and digits only, folded by hand,
 * because toLowerCase() would turn the Kelvin sign into a k. The two words
 * must run together into exactly one list pair (no two pairs run together
 * the same way), and what comes back is built from the lists' own strings.
 */
export function normaliseCode(raw) {
  if (typeof raw !== 'string') return null;
  const s = raw;
  if (s.length > CODE_TYPED_MAX || !/^[A-Za-z0-9 -]*$/.test(s)) return null;
  const folded = s.replace(/[ -]/g, '').replace(/[A-Z]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 32));
  const m = /^([a-z]+)([1-9][0-9]?)$/.exec(folded);
  // A Map, not an object: "constructor" or "__proto__" typed in is just a key nobody set.
  const pair = m ? CODE_JOINED.get(m[1]) : null;
  if (!pair || !CODE_NUM.has(Number(m[2]))) return null;
  return formatCode({ first: pair.first, second: pair.second, number: Number(m[2]) });
}

/**
 * The code a player joined by, from the id they joined — or null if they
 * joined from the list, or the id is not one the game could have made.
 */
export function codeOfId(id) {
  const m = /^ifs-code-(.+)$/.exec(typeof id === 'string' ? id : '');
  return m ? shownCode(m[1]) : null;
}

/**
 * A map's name, from this copy of the game's own list — never the text the
 * host sent, which could be anything.
 */
export function mapNameFor(id) {
  const m = MAPS.find((x) => x.id === id);
  return m ? m.name : 'An island';
}

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

/* ------------------------------------------------------------------ */
/* Colours, chat and games                                             */
/* ------------------------------------------------------------------ */

/** Eight colours a ten-year-old can tell apart across a sky. */
export const COLOURS = ['#ff5a4f', '#ff9f1c', '#ffd23f', '#4fd684', '#2ec4b6', '#58c6ff', '#a78bfa', '#ff7eb6'];
export const COLOUR_NAMES = ['Red', 'Orange', 'Yellow', 'Green', 'Teal', 'Blue', 'Purple', 'Pink'];

export function safeColour(c) {
  return COLOURS.includes(c) ? c : COLOURS[5];
}

/*
 * Quick chat — the whole of the chat.
 *
 * No free text, on purpose: this is a class of ten-year-olds. The first four
 * are on number keys 3 to 6; all of them are in the little menu, which is the
 * only way to chat on an iPad. They travel as a number, so nothing anybody
 * types can ever arrive on somebody else's screen.
 */
export const QUICK_CHAT = [
  { text: 'Nice landing!', key: 'Digit3' },
  { text: 'Follow me!', key: 'Digit4' },
  { text: 'Race you!', key: 'Digit5' },
  { text: '👋 Wave', key: 'Digit6', emote: true },
  { text: 'Wait for me!' },
  { text: 'Over here!' },
  { text: 'Let’s land!' },
  { text: 'Good game!' },
  { text: '👍' , emote: true },
  { text: '😂', emote: true },
];

export function chatIndexForKey(code) {
  return QUICK_CHAT.findIndex((c) => c.key === code);
}

export const GAMES = ['flight', 'heli', 'boat', 'car'];
export const GAME_LABEL = { flight: 'Flight', heli: 'Heli', boat: 'Boat', car: 'Car' };

/* ------------------------------------------------------------------ */
/* State snapshots                                                     */
/* ------------------------------------------------------------------ */

/*
 * One snapshot, little-endian:
 *
 *    0  u8   'S' (0x53) — which is also the format version
 *    1  u8   player id (the host overwrites it when relaying, so nobody can
 *            speak for somebody else)
 *    2  u16  sequence
 *    4  u32  sender's clock, ms
 *    8  f32  x, y, z                    metres
 *   20  i16  qx, qy, qz, qw             × 32767
 *   28  i16  vx, vy, vz                 × 20 (0.05 m/s, ±1,638 m/s)
 *   34  u8   game (0 flight, 1 heli, 2 boat, 3 car)
 *   35  u8   flags: gear down, lights, engine, on ground, crashed, brakes, ghost, pvp
 *   36  u8   gear position               0..255
 *   37  u8   flaps                       0..255
 *   38  u8   throttle                    0..255
 *   39  u8   rpm (engine or rotor)       × 100
 *   40  i8   pitch, roll, yaw, steer     × 127
 *   44  u8   length of the type id, then the id in ASCII (at most 24)
 *
 * About fifty bytes, fifteen times a second. Positions stay floats: at twenty
 * kilometres from the origin a float32 is still good to two millimetres, and
 * quantising them to save six bytes is not worth the edge cases.
 *
 * THE WALKING PILOT (PROTO 4): "people on other computers should see you,
 * the human". While a player is out on foot their snapshot carries the
 * vehicle as ever (parked, or a runaway plane flying itself) and then, after
 * the type id, a tail of nineteen bytes:
 *
 *    0  u8   'W' (0x57)
 *    1  f32  x, y, z                    the walker's feet, metres
 *   13  u16  heading                    × 65536 / 360
 *   15  u8   speed                      × 20 (0.05 m/s, to 12.75)
 *   16  u8   flags: in the air, knocked down, waving, paddling
 *   17  u8   outfit                     an index into WALK_OUTFITS
 *   18  u8   knock-down count           (mod 256: which fall this is)
 *
 * About 285 bytes a second, and only while walking. The fall itself — the
 * ragdoll — is one reliable event, 'pilot:down' (../pilot-mp.js), and every
 * game that sees it simulates the same fall from the same pose: no limbs
 * cross the network.
 */
export const STATE_MAGIC = 0x53;
export const STATE_HEAD = 45;
const TYPE_MAX = 24;
export const WALK_MAGIC = 0x57;
export const WALK_TAIL = 19;
/** What a walker may be wearing, by index: person.js's outfits, then uniforms.js's. Nothing else is drawn. */
export const WALK_OUTFITS = Object.freeze([
  'pilot', 'passenger', 'staff', 'police', 'tactical', 'hijacker',
  'captain', 'fighter', 'heli', 'casual', 'racer', 'harrison',
]);
const WALK_FLAG = { air: 1, down: 2, wave: 4, wading: 8 };

/*
 * ghost and pvp are list 2, part 2: a player nobody can bump into or hit
 * right now (just arrived, tagged out and coming back, on the ground, racing)
 * and a player with PvP switched on. Two spare bits, so an older copy reads
 * the rest of the snapshot exactly as before.
 */
const FLAG = { gearDown: 1, lights: 2, engineOn: 4, onGround: 8, crashed: 16, brakes: 32, ghost: 64, pvp: 128 };

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const num = (v, d = 0) => (Number.isFinite(v) ? v : d);

export function encodeState(s) {
  const type = String(s.type || '').replace(/[^a-z0-9_-]/gi, '').slice(0, TYPE_MAX);
  const w = s.walk && typeof s.walk === 'object' ? s.walk : null;
  const buf = new ArrayBuffer(STATE_HEAD + type.length + (w ? WALK_TAIL : 0));
  const dv = new DataView(buf);
  dv.setUint8(0, STATE_MAGIC);
  dv.setUint8(1, clamp(s.id | 0, 0, 255));
  dv.setUint16(2, (s.seq | 0) & 0xffff, true);
  dv.setUint32(4, Math.round(num(s.t)) >>> 0, true);
  const p = s.pos || {};
  dv.setFloat32(8, num(p.x), true);
  dv.setFloat32(12, num(p.y), true);
  dv.setFloat32(16, num(p.z), true);
  const q = s.quat || { w: 1 };
  const ql = Math.hypot(num(q.x), num(q.y), num(q.z), num(q.w, 1)) || 1;
  dv.setInt16(20, Math.round((num(q.x) / ql) * 32767), true);
  dv.setInt16(22, Math.round((num(q.y) / ql) * 32767), true);
  dv.setInt16(24, Math.round((num(q.z) / ql) * 32767), true);
  dv.setInt16(26, Math.round((num(q.w, 1) / ql) * 32767), true);
  const v = s.vel || {};
  dv.setInt16(28, clamp(Math.round(num(v.x) * 20), -32767, 32767), true);
  dv.setInt16(30, clamp(Math.round(num(v.y) * 20), -32767, 32767), true);
  dv.setInt16(32, clamp(Math.round(num(v.z) * 20), -32767, 32767), true);
  dv.setUint8(34, clamp(GAMES.indexOf(s.game), 0, 3));
  let f = 0;
  for (const k in FLAG) if (s[k]) f |= FLAG[k];
  dv.setUint8(35, f);
  dv.setUint8(36, clamp(Math.round(num(s.gearPos, 1) * 255), 0, 255));
  dv.setUint8(37, clamp(Math.round(num(s.flaps) * 255), 0, 255));
  dv.setUint8(38, clamp(Math.round(num(s.throttle) * 255), 0, 255));
  dv.setUint8(39, clamp(Math.round(num(s.rpm) * 100), 0, 255));
  dv.setInt8(40, clamp(Math.round(num(s.pitch) * 127), -127, 127));
  dv.setInt8(41, clamp(Math.round(num(s.roll) * 127), -127, 127));
  dv.setInt8(42, clamp(Math.round(num(s.yaw) * 127), -127, 127));
  dv.setInt8(43, clamp(Math.round(num(s.steer) * 127), -127, 127));
  dv.setUint8(44, type.length);
  for (let i = 0; i < type.length; i++) dv.setUint8(STATE_HEAD + i, type.charCodeAt(i));
  if (w) writeWalk(dv, STATE_HEAD + type.length, w);
  return buf;
}

function writeWalk(dv, o, w) {
  dv.setUint8(o, WALK_MAGIC);
  dv.setFloat32(o + 1, num(w.x), true);
  dv.setFloat32(o + 5, num(w.y), true);
  dv.setFloat32(o + 9, num(w.z), true);
  const h = ((num(w.heading) % 360) + 360) % 360;
  dv.setUint16(o + 13, Math.round((h / 360) * 65536) & 0xffff, true);
  dv.setUint8(o + 15, clamp(Math.round(num(w.speed) * 20), 0, 255));
  let f = 0;
  for (const k in WALK_FLAG) if (w[k]) f |= WALK_FLAG[k];
  dv.setUint8(o + 16, f);
  const oi = WALK_OUTFITS.indexOf(w.outfit);
  dv.setUint8(o + 17, oi < 0 ? 0 : oi);
  dv.setUint8(o + 18, (num(w.knock) | 0) & 0xff);
}

/** A walker's tail, checked: null for anything that is not one. */
function readWalk(dv, o) {
  if (dv.getUint8(o) !== WALK_MAGIC) return null;
  const x = dv.getFloat32(o + 1, true);
  const y = dv.getFloat32(o + 5, true);
  const z = dv.getFloat32(o + 9, true);
  if (![x, y, z].every((n) => Number.isFinite(n) && Math.abs(n) < 1e5)) return null;
  const f = dv.getUint8(o + 16);
  const oi = dv.getUint8(o + 17);
  return {
    x, y, z,
    heading: (dv.getUint16(o + 13, true) / 65536) * 360,
    speed: dv.getUint8(o + 15) / 20,
    air: !!(f & WALK_FLAG.air),
    down: !!(f & WALK_FLAG.down),
    wave: !!(f & WALK_FLAG.wave),
    wading: !!(f & WALK_FLAG.wading),
    outfit: WALK_OUTFITS[oi] || 'pilot',
    knock: dv.getUint8(o + 18),
  };
}

/** Decode, or null for anything that is not a well-formed snapshot. */
export function decodeState(buf) {
  if (!buf || typeof buf.byteLength !== 'number' || buf.byteLength < STATE_HEAD || buf.byteLength > STATE_HEAD + TYPE_MAX + WALK_TAIL) return null;
  const dv = buf instanceof DataView ? buf : new DataView(buf.buffer || buf, buf.byteOffset || 0, buf.byteLength);
  if (dv.getUint8(0) !== STATE_MAGIC) return null;
  const len = dv.getUint8(44);
  if (len > TYPE_MAX || STATE_HEAD + len > dv.byteLength) return null;
  // After the type: nothing, or exactly one walker's tail.
  const rest = dv.byteLength - STATE_HEAD - len;
  let walk = null;
  if (rest === WALK_TAIL) {
    walk = readWalk(dv, STATE_HEAD + len);
    if (!walk) return null;
  } else if (rest !== 0) return null;
  let type = '';
  for (let i = 0; i < len; i++) {
    const c = dv.getUint8(STATE_HEAD + i);
    const ch = String.fromCharCode(c);
    if (!/[a-z0-9_-]/i.test(ch)) return null;
    type += ch;
  }
  const x = dv.getFloat32(8, true);
  const y = dv.getFloat32(12, true);
  const z = dv.getFloat32(16, true);
  // Anything past a hundred kilometres is not a place in this game.
  if (![x, y, z].every((n) => Number.isFinite(n) && Math.abs(n) < 1e5)) return null;
  let qx = dv.getInt16(20, true) / 32767;
  let qy = dv.getInt16(22, true) / 32767;
  let qz = dv.getInt16(24, true) / 32767;
  let qw = dv.getInt16(26, true) / 32767;
  const ql = Math.hypot(qx, qy, qz, qw);
  if (ql < 0.5) return null;
  qx /= ql; qy /= ql; qz /= ql; qw /= ql;
  const f = dv.getUint8(35);
  const flags = {};
  for (const k in FLAG) flags[k] = !!(f & FLAG[k]);
  return {
    id: dv.getUint8(1),
    seq: dv.getUint16(2, true),
    t: dv.getUint32(4, true),
    pos: { x, y, z },
    quat: { x: qx, y: qy, z: qz, w: qw },
    vel: { x: dv.getInt16(28, true) / 20, y: dv.getInt16(30, true) / 20, z: dv.getInt16(32, true) / 20 },
    game: GAMES[dv.getUint8(34)] || 'flight',
    ...flags,
    gearPos: dv.getUint8(36) / 255,
    flaps: dv.getUint8(37) / 255,
    throttle: dv.getUint8(38) / 255,
    rpm: dv.getUint8(39) / 100,
    pitch: dv.getInt8(40) / 127,
    roll: dv.getInt8(41) / 127,
    yaw: dv.getInt8(42) / 127,
    steer: dv.getInt8(43) / 127,
    type,
    // PROTO 4: out on foot, where the pilot is (null in the seat).
    walk,
  };
}

/** Rewrite the id byte of an encoded snapshot in place — what the host does when relaying. */
export function stampStateId(buf, id) {
  const dv = new DataView(buf);
  dv.setUint8(1, id & 0xff);
  return buf;
}

/*
 * A bundle: the host's way of sending one player everybody else's newest
 * snapshots in ONE packet.
 *
 *    0  u8   'B' (0x42)
 *    1  u8   how many (1 to 8)
 *    2  then each: u8 length, and that many bytes of one snapshot as above
 *
 * It used to relay every snapshot the moment it arrived: in a lobby of
 * eight that is the host sending 7 × 15 of its own plus 7 × 6 × 15 relayed
 * — 735 small packets a second from one Chromebook, on the same access
 * point as the other 39 in the class, and every packet on Wi-Fi costs its
 * airtime however small it is. Bundled every 50 ms or so, it is about 20 a
 * second to each player. Only ever host → player; a player's own snapshot
 * to the host is a plain one.
 */
export const BUNDLE_MAGIC = 0x42;

export function encodeBundle(bufs) {
  const list = bufs.slice(0, PLAYER_IDS);
  let len = 2;
  for (const b of list) len += 1 + b.byteLength;
  const out = new Uint8Array(len);
  out[0] = BUNDLE_MAGIC;
  out[1] = list.length;
  let at = 2;
  for (const b of list) {
    out[at++] = b.byteLength;
    out.set(new Uint8Array(b), at);
    at += b.byteLength;
  }
  return out.buffer;
}

/** The snapshots in a bundle, as byte views — or null for anything that is not a well-formed bundle. */
export function decodeBundle(buf) {
  if (!buf || typeof buf.byteLength !== 'number' || buf.byteLength < 2 || buf.byteLength > 2 + PLAYER_IDS * (1 + STATE_HEAD + TYPE_MAX)) return null;
  const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf.buffer || buf, buf.byteOffset || 0, buf.byteLength);
  if (u8[0] !== BUNDLE_MAGIC) return null;
  const n = u8[1];
  if (n < 1 || n > PLAYER_IDS) return null;
  const parts = [];
  let at = 2;
  for (let i = 0; i < n; i++) {
    const len = u8[at];
    if (len === undefined || len < STATE_HEAD || at + 1 + len > u8.byteLength) return null;
    parts.push(u8.subarray(at + 1, at + 1 + len));
    at += 1 + len;
  }
  return at === u8.byteLength ? parts : null;
}

/** Every snapshot in whatever the state channel carried — a plain snapshot or a bundle — decoded; the malformed ones left out. */
export function decodeStates(buf) {
  if (!buf || typeof buf.byteLength !== 'number' || buf.byteLength < 1) return [];
  const first = new Uint8Array(buf.buffer || buf, buf.byteOffset || 0, 1)[0];
  if (first === BUNDLE_MAGIC) {
    const parts = decodeBundle(buf);
    if (!parts) return [];
    const out = [];
    for (const p of parts) {
      const s = decodeState(p);
      if (s) out.push(s);
    }
    return out;
  }
  const s = decodeState(buf);
  return s ? [s] : [];
}

/* ------------------------------------------------------------------ */
/* Reliable events                                                     */
/* ------------------------------------------------------------------ */

/*
 * Every event is a small JSON object with a `t`. They are read through
 * readEvent(), which throws nothing and returns null for anything malformed,
 * oversized or unknown — the other end of a data channel is a browser tab
 * somebody else controls, and the game must not be one bad packet from a
 * crash.
 */
export const EVENT_MAX_BYTES = 4096;
const EVENTS = new Set([
  'hello', 'welcome', 'deny', 'join', 'leave', 'roster', 'chat', 'kick', 'close', 'move', 'bye', 'ping', 'pong', 'info?', 'info',
  // Game events and shared state, for other features (events.js).
  'gev', 'gst',
  // Admin (admin.js): the host's question, the admin's signed answer, and an admin's request to the host.
  'chal', 'prove', 'adm',
]);

export function writeEvent(ev) {
  return JSON.stringify(ev);
}

export function readEvent(data) {
  if (typeof data !== 'string' || data.length > EVENT_MAX_BYTES) return null;
  let ev;
  try {
    ev = JSON.parse(data);
  } catch (e) {
    return null;
  }
  if (!ev || typeof ev !== 'object' || Array.isArray(ev) || !EVENTS.has(ev.t)) return null;
  return ev;
}

/** A player as another player may see them. Everything re-checked on arrival. */
export function readPlayer(p) {
  if (!p || typeof p !== 'object') return null;
  const id = Number(p.id);
  if (!Number.isInteger(id) || id < 0 || id >= PLAYER_IDS) return null;
  const rank = Number(p.rank);
  return {
    id,
    name: safeName(p.name, callSignForId(id)),
    colour: safeColour(p.colour),
    host: !!p.host,
    ping: Number.isFinite(p.ping) ? clamp(Math.round(p.ping), 0, 9999) : null,
    // The order they joined in, which is who hosts next if the host goes (lobby.js). A number, nothing shown.
    rank: Number.isInteger(rank) && rank >= 0 && rank < 1e9 ? rank : 1e9 + id,
    // Part 3b: what the host says about them, as flags — an admin (it checked their signature), muted or frozen by one.
    admin: p.adm === 1,
    muted: p.mu === 1,
    frozen: p.fz === 1,
  };
}

/** Where a map is in this copy's list, for sending as a number; -1 for one it does not have. */
export function mapIndex(id) {
  return MAPS.findIndex((m) => m.id === id);
}

/** The map at that place in this copy's list, or null. */
export function mapAtIndex(i) {
  return Number.isInteger(i) && i >= 0 && i < MAPS.length ? MAPS[i].id : null;
}

/**
 * A lobby host's pong: how many are in, the most there can be, and which map
 * and game, as numbers — never a name. Null for a pong that is not one.
 */
export function readLobbyCount(meta) {
  if (!meta || typeof meta !== 'object' || meta.k !== 'pong') return null;
  const n = Number(meta.n);
  const m = Number(meta.max);
  if (!Number.isInteger(n) || !Number.isInteger(m)) return null;
  const max = clamp(m, 1, LOBBY_MAX);
  const players = clamp(n, 0, max);
  const map = mapAtIndex(Number(meta.m));
  const g = Number(meta.g);
  return {
    players,
    max,
    full: players >= max,
    map,
    mapName: map ? mapNameFor(map) : 'An island',
    game: Number.isInteger(g) && GAMES[g] ? GAMES[g] : 'flight',
    v: Number(meta.v) | 0,
    // The bumping rule (BUMP_RULES), as a number; a host that does not say has the default.
    bump: BUMP_RULES[bumpRule(meta.b)],
  };
}

/**
 * A private match's pong, for the card a friend sees when they type its
 * code: how many are in it, the most there can be, its island and game —
 * numbers only, as a lobby's — and whether its host has locked it. Null
 * for a pong that is not one.
 */
export function readPrivateCount(meta) {
  const c = readLobbyCount(meta);
  if (!c) return null;
  const max = clamp(Number(meta.max) | 0, 1, CODE_GAME_MAX);
  const players = clamp(c.players, 0, max);
  return { ...c, players, max, full: players >= max, locked: !!meta.lk, map: meta.m === undefined ? null : c.map };
}

/**
 * A ping as the player list shows it: to the nearest 10 ms under 100, the
 * nearest 100 up to a second, and "over 1000 ms" after that.
 *
 * Coarse on purpose. The host sends everybody's ping to everybody, so a
 * modified host could otherwise pick the number — 88 ms, 1488 ms — and the
 * only numbers this can show are 10 to 90 and 100 to 1000 in round steps,
 * none of them a hate symbol. Nobody flying needs the milliseconds.
 */
export function pingLabel(ms) {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms < 0) return '';
  if (ms < 5) return 'under 10 ms';
  if (ms < 95) return `${Math.round(ms / 10) * 10} ms`;
  if (ms < 1050) return `${Math.round(ms / 100) * 100} ms`;
  return 'over 1000 ms';
}

/** Server info from the LAN list, checked the same way. */
export function readInfo(ev) {
  if (!ev || ev.t !== 'info') return null;
  const game = GAMES.includes(ev.game) ? ev.game : 'flight';
  const players = clamp(Number(ev.players) | 0, 0, MAX_PLAYERS);
  const max = clamp(Number(ev.max) | 0, 1, MAX_PLAYERS);
  return {
    name: safeServerName(ev.name),
    map: String(ev.map || '').replace(/[^a-z0-9_-]/gi, '').slice(0, 32),
    // From this copy's own list of maps; the host's text is not shown.
    mapName: mapNameFor(ev.map),
    game,
    players,
    max,
    full: players >= max,
    locked: !!ev.locked,
    v: Number(ev.v) | 0,
  };
}

/**
 * The head-count a host's pong carries — numbers only; the name and the map
 * come over the data channel. Null for a pong that has none.
 */
export function readCount(meta) {
  if (!meta || typeof meta !== 'object' || meta.k !== 'pong') return null;
  const n = Number(meta.n);
  const m = Number(meta.max);
  if (!Number.isInteger(n) || !Number.isInteger(m)) return null;
  const max = clamp(m, 1, MAX_PLAYERS);
  const players = clamp(n, 0, max);
  return { players, max, full: players >= max, locked: !!meta.lk, v: Number(meta.v) | 0 };
}

export function readWeather(w) {
  if (!w || typeof w !== 'object') return null;
  const out = {};
  // weather.js looks these up in its own tables; 'constructor' is in every table, so it is refused here.
  const word = (v) => typeof v === 'string' && /^[a-z]{1,16}$/.test(v) && !(v in Object.prototype);
  if (word(w.time)) out.time = w.time;
  if (word(w.condition)) out.condition = w.condition;
  if (Number.isFinite(w.windSpeedKts)) out.windSpeedKts = clamp(w.windSpeedKts, 0, 40);
  if (Number.isFinite(w.windDirDeg)) out.windDirDeg = ((w.windDirDeg % 360) + 360) % 360;
  return out;
}

/** Where the host is, for dropping a joiner beside them. */
export function readSpawn(at) {
  if (!at || typeof at !== 'object') return null;
  const n = (v) => (Number.isFinite(v) && Math.abs(v) < 1e5 ? v : null);
  const x = n(at.x);
  const y = n(at.y);
  const z = n(at.z);
  if (x === null || y === null || z === null) return null;
  return {
    x, y, z,
    heading: n(at.heading) ?? 90,
    speed: clamp(n(at.speed) ?? 0, 0, 400),
    agl: n(at.agl) ?? 0,
    onGround: !!at.onGround,
  };
}

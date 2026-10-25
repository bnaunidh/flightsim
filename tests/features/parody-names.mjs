/**
 * Node checks for the airline names: parody, never a real company.
 *
 *   node tests/features/parody-names.mjs
 *
 * The legal pass (briefs/next-week.md, "SAFE PARODY COMPANIES"): a scheme may
 * use a real airline's colours, but never its name, a retired name it still
 * owns, or its radio callsign. So every livery name — and the brand the
 * ambient traffic reads off it for the radio (traffic.js strips a trailing
 * "Air"/"States") — is checked, as whole words, against the real names the
 * schemes were styled after and the other big ones a kid would know.
 *
 * "Continental States" was the one that failed this: Continental was a real
 * airline whose marks United owns. It is "Ununited" now, the United parody
 * from the owner's table, in the same two blues.
 */
import { fileURLToPath } from 'node:url';

const L = await import(new URL('../../src/aircraft/liveries.js', import.meta.url).href);

let fails = 0;
let n = 0;
const ok = (name, pass, detail) => {
  n++;
  if (!pass) fails++;
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

/** Real airline names, their callsigns and the shorthand people use. Whole-word matches only. */
const REAL = [
  'KLM', 'Delta', 'Emirates', 'Etihad', 'DHL', 'FedEx', 'UPS', 'Air India', 'Singapore Airlines', 'Singapore',
  'Air France', 'Spirit', 'United', 'Continental', 'British Airways', 'Speedbird', 'Turkish', 'Turkish Airlines',
  'Qatar', 'Qatar Airways', 'Japan Airlines', 'JAL', 'Ethiopian', 'Ethiopian Airlines', 'American', 'American Airlines',
  'Lufthansa', 'Ryanair', 'Southwest', 'easyJet', 'Air Canada', 'Qantas', 'Virgin', 'Alaska', 'JetBlue', 'Frontier',
  'Cathay', 'Cathay Pacific', 'ANA', 'Korean Air', 'Iberia', 'Aeroflot', 'Finnair', 'Swiss', 'Austrian', 'TAP',
  'Air New Zealand', 'Hawaiian', 'Allegiant', 'WestJet', 'Pan Am', 'TWA', 'Northwest', 'US Airways', 'Eastern',
];
const word = (name, real) => new RegExp(`(^|[^A-Za-z])${real.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^A-Za-z])`, 'i').test(name);
const brandOf = (name) => String(name).replace(/\s+(Air|States)$/i, '');

const schemes = L.LIVERIES.filter((l) => !l.house);
ok('there are airline schemes to check', schemes.length >= 5, `${schemes.length} schemes`);

const hits = [];
for (const l of schemes) {
  for (const text of [l.name, brandOf(l.name), l.callsign, L.radioBrand ? L.radioBrand(l) : null].filter(Boolean)) {
    for (const real of REAL) if (word(text, real)) hits.push(`${l.id}: "${text}" matches ${real}`);
  }
}
ok('no livery name, radio callsign or radio brand read off it is a real airline\'s name or callsign', hits.length === 0, hits.join('; '));

// The owner's safe-parody table (briefs/next-week.md): every company on it is in the game, under its table name.
const TABLE = ['Kanal Royal Dutch Air', 'Riverdelta Air', 'Desert Pearl Airlines', 'Sandline Air', 'Dash Freight', 'FlexShip Express', 'Parcel Brown Express',
  'Royal Isles Airways', 'Bosphorus Air', 'Pearl Gulf Airways', 'Rising Crane Air', 'Spit Air', 'OverSea Airways', 'Abyssinia Air', 'Ununited'];
const missing = TABLE.filter((name) => !schemes.some((l) => l.name === name));
ok('every company on the owner\'s safe-parody table flies', missing.length === 0, missing.join(', ') || TABLE.length + ' companies');
ok('the radio brand is the scheme\'s callsign when it has one, else the name without a trailing Air', L.radioBrand(L.findLivery('krd')) === 'Kanal' && L.radioBrand(L.findLivery('nightfreight')) === 'Night Freight' && L.radioBrand(L.findLivery('abyssinia')) === 'Abyssinia');
ok('no radio brand is longer than two words (it is read with a number after it)', schemes.filter((l) => !l.special).every((l) => L.radioBrand(l).split(/\s+/).length <= 2), schemes.filter((l) => !l.special).map((l) => L.radioBrand(l)).join(', '));

const cont = L.findLivery ? L.findLivery('continental') : L.LIVERIES.find((l) => l.id === 'continental');
ok('the former "Continental States" is the United parody, Ununited, under its old id', !!cont && cont.name === 'Ununited' && cont.id === 'continental' && cont.accent === '#1a4f8a', cont ? cont.name : 'missing');
ok('…and its radio brand is the whole word, nothing stripped', brandOf('Ununited') === 'Ununited');
ok('the table\'s other matches are already parody names', ['Abyssinia Air'].every((name) => schemes.some((l) => l.name === name)));

const names = schemes.map((l) => l.name);
ok('every scheme has a distinct name', new Set(names).size === names.length, names.join(', '));

console.log(`\n${n - fails}/${n} passed`);
process.exit(fails ? 1 : 0);

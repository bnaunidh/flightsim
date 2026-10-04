/**
 * Node checks for what a mission pays. Run from the repo root with plain node:
 *
 *   node tests/features/credits.mjs            (add --table for every mission)
 *
 * "The harder the mission and category, the more credits you get." This
 * prices EVERY mission the game has — flight, helicopter, boat, the van's
 * jobs, the rocket, the extras — through the same progression.js the game
 * pays with, and the same menus.js heading the board files it under, and
 * checks the shape of it:
 *
 *   1. Every difficulty label in use is a known one, ranked, in one order.
 *   2. Within a heading, a harder mission never pays less.
 *   3. At the same difficulty, a more demanding heading pays more.
 *   4. A hard mission in the hardest heading is 3–4× an easy lesson.
 *   5. Round numbers, on every settings difficulty.
 *   6. Missions that do not exist yet are priced from their two fields.
 *   7. Crashing pays nothing and takes nothing; the score decides the share.
 *   8. Every award() call site's shape: missions, flight school, the rocket's
 *      free launches (which ignore the settings), the hijack the dice bring.
 *   9. The economy, before and after, for a typical kid — and that nothing in
 *      the hangar is instantly affordable or out of reach.
 */

global.document = {
  createElement: () => ({
    getContext: () => new Proxy({}, { get: () => () => ({ addColorStop() {}, data: new Uint8ClampedArray(4) }) }),
    width: 0,
    height: 0,
    style: {},
  }),
  body: { appendChild() {} },
};
// award() saves; in node there is nowhere to save to.
const store = new Map();
global.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };

const root = new URL('../../', import.meta.url);
const load = (p) => import(new URL(p, root).href);

const Menus = await load('src/ui/menus.js');
const Prog = await load('src/game/progression.js');
const { MISSIONS, gameOf } = await load('src/game/missions.js');
const { ROCKET_MISSIONS } = await load('src/features/rocket/flights.js');
const { CAMPAIGN_PART_A } = await load('src/game/campaign.js');
const { CAMPAIGN_PART_B } = await load('src/game/campaign-b.js');
let HARRISON = null;
try {
  HARRISON = (await load('src/features/tpose.js')).HARRISON_PRICE;
} catch (e) {
  HARRISON = 3601; // the shop row tpose.js adds at load; its price, as written there
}

const TABLE = process.argv.includes('--table');
let failed = 0;
let passed = 0;
function ok(name, pass, detail = '') {
  if (pass) passed++;
  else failed++;
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
}

/*
 * Every mission, as the board sees it. The rocket's go on the board through
 * rocket/menu.js with category 'space' and game 'rocket' — priced the same way
 * here as there.
 */
const ALL = [
  ...MISSIONS.map((m) => ({ def: m, game: gameOf(m) })),
  ...ROCKET_MISSIONS.map((m) => ({ def: { ...m, category: 'space', game: 'rocket' }, game: 'rocket' })),
];
const SETTINGS = ['easy', 'normal', 'realistic'];
const priced = ALL.map(({ def, game }) => {
  const cat = Menus.missionCategory(def);
  const row = { id: def.id, name: def.name, game, diff: def.difficulty, rank: Prog.difficultyRank(def.difficulty), cat, tier: Prog.categoryTier(cat).tier, def };
  for (const s of SETTINGS) row[s] = Prog.maxPayout(def, { settings: s, game });
  return row;
});

/* ---- 1. the difficulty labels ------------------------------------------ */

const labelsInUse = new Set([
  ...priced.map((r) => r.diff),
  ...CAMPAIGN_PART_A.map((m) => m.difficulty),
  ...CAMPAIGN_PART_B.map((m) => m.difficulty),
  'Free', // the free-roam entries: BOAT_PATROL, ISLAND_ROADS
].filter(Boolean));
for (const l of labelsInUse) {
  const row = Prog.difficultyOf(l);
  ok(`difficulty "${l}" is a known row, not a guess`, row.label.toLowerCase() === String(l).toLowerCase(), `${row.label}, rank ${row.rank}`);
}
const ladder = Prog.DIFFICULTIES.map((d) => d.label);
ok('the ranks run Free < Training < Easy < Medium < Hard < Very hard < Expert',
  ladder.join(',') === 'Free,Training,Easy,Medium,Hard,Very hard,Expert'
    && Prog.DIFFICULTIES.every((d, i) => d.rank === i && Prog.difficultyRank(d.label) === i),
  ladder.map((l) => `${l}=${Prog.difficultyRank(l)}`).join(' '));
ok('a sort by difficultyRank() puts the board in order',
  ['Very hard', 'Easy', 'Expert', 'Medium', 'Training', 'Hard', 'Free'].sort((a, b) => Prog.difficultyRank(a) - Prog.difficultyRank(b)).join(',') === ladder.join(','));
ok('the pay rises with every rank', Prog.DIFFICULTIES.every((d, i, a) => i === 0 || d.pay > a[i - 1].pay), Prog.DIFFICULTIES.map((d) => d.pay).join(' < '));

/* ---- 2 & 3. monotonic within a heading, and across headings ----------- */

const cats = [...new Set(priced.map((r) => r.cat))];
for (const s of SETTINGS) {
  let worst = '';
  for (const c of cats) {
    const rows = priced.filter((r) => r.cat === c);
    for (const a of rows) for (const b of rows) {
      if (a.rank < b.rank && !(a[s] < b[s])) worst = `${a.id} (${a.diff}) ${a[s]} vs ${b.id} (${b.diff}) ${b[s]}`;
      if (a.rank === b.rank && a[s] !== b[s]) worst = `${a.id} and ${b.id} are both ${a.diff} in ${c} but pay ${a[s]} and ${b[s]}`;
    }
  }
  ok(`${s}: within every heading, a harder mission pays more, the same difficulty the same`, !worst, worst || `${cats.length} headings`);

  /*
   * The rocket does not read the settings difficulty, so on Easy and
   * Realistic it is compared with itself only: an aeroplane on Easy has a
   * softer undercarriage and pays for it, a rocket on Easy is the same rocket.
   * On Normal everything is compared with everything.
   */
  let cross = '';
  let pairs = 0;
  const steady = (r) => r.game === 'rocket';
  for (const a of priced) for (const b of priced) {
    if (a.rank !== b.rank || a.tier >= b.tier) continue;
    if (s !== 'normal' && steady(a) !== steady(b)) continue;
    pairs++;
    if (!(a[s] < b[s])) cross = `${a.id} (${a.cat}, tier ${a.tier}) ${a[s]} vs ${b.id} (${b.cat}, tier ${b.tier}) ${b[s]}`;
  }
  ok(`${s}: at the same difficulty, a more demanding heading pays more`, !cross, cross || `${pairs} pairs`);

  // The whole grid, so it holds for missions nobody has written yet.
  let grid = '';
  for (const d of Prog.DIFFICULTIES) {
    for (const t of Prog.CATEGORY_TIERS) {
      const v = Prog.maxPayout({ difficulty: d.label }, { category: t.categories[0], settings: s });
      const harder = Prog.DIFFICULTIES[d.rank + 1];
      const tougher = Prog.CATEGORY_TIERS[t.tier];
      if (harder && !(Prog.maxPayout({ difficulty: harder.label }, { category: t.categories[0], settings: s }) > v)) grid = `${harder.label} in ${t.name} is not above ${d.label}`;
      if (tougher && !(Prog.maxPayout({ difficulty: d.label }, { category: tougher.categories[0], settings: s }) > v)) grid = `${d.label} in ${tougher.name} is not above ${t.name}`;
    }
  }
  ok(`${s}: the whole difficulty × tier grid rises both ways`, !grid, grid || `${Prog.DIFFICULTIES.length} × ${Prog.CATEGORY_TIERS.length}`);
  ok(`${s}: every mission's most is a round ten`, priced.every((r) => r[s] % 10 === 0 && r[s] >= 10), priced.filter((r) => r[s] % 10).map((r) => r.id).join(', '));
}

/* ---- 4. the spread the owner asked for -------------------------------- */

const easyLesson = Prog.maxPayout({ difficulty: 'Easy' }, { category: 'training' });
const hardElite = Prog.maxPayout({ difficulty: 'Hard' }, { category: 'military' });
const hardRescue = Prog.maxPayout({ difficulty: 'Hard' }, { category: 'rescue' });
ok('a Hard mission in the hardest heading pays 3–4× an Easy lesson', hardElite / easyLesson >= 3 && hardElite / easyLesson <= 4,
  `${hardElite} / ${easyLesson} = ${(hardElite / easyLesson).toFixed(2)}×; Hard rescue ${hardRescue} = ${(hardRescue / easyLesson).toFixed(2)}×`);
const circuit = priced.find((r) => r.id === 'circuit');
const carrier = priced.find((r) => r.id === 'carrierqual');
ok('Island Circuit no longer pays what a carrier trap pays', circuit.normal * 3 < carrier.normal, `${circuit.normal} vs ${carrier.normal}`);
ok('every mission in every game is priced', priced.length >= 50 && priced.every((r) => r.normal > 0)
  && ['flight', 'heli', 'boat', 'car', 'rocket'].every((g) => priced.some((r) => r.game === g)),
  `${priced.length} missions: ${['flight', 'heli', 'boat', 'car', 'rocket'].map((g) => `${g} ${priced.filter((r) => r.game === g).length}`).join(', ')}`);

/* ---- 5. settings difficulty, as today --------------------------------- */

ok('Easy settings pay less and Realistic more, on every mission',
  priced.filter((r) => r.game !== 'rocket').every((r) => r.easy < r.normal && r.normal < r.realistic));
ok('the rocket ignores the settings, as its flying does', priced.filter((r) => r.game === 'rocket').every((r) => r.easy === r.normal && r.normal === r.realistic),
  priced.filter((r) => r.game === 'rocket').map((r) => `${r.id} ${r.normal}`).join(', '));

/* ---- 6. missions that do not exist yet -------------------------------- */

const future = [
  [{ id: 'x1', name: 'Stunt Show', difficulty: 'Tricky', category: 'stunts' }, 'hard', 2],
  [{ id: 'x2', name: 'Wildfire on the Ridge', difficulty: 'Hard' }, 'hard', 3],
  [{ id: 'x3', name: 'Pizza Run', difficulty: 'Very Hard', category: 'Deliveries' }, 'very-hard', 2],
  [{ id: 'x4', name: 'Night Strike', difficulty: 'Expert', military: true }, 'expert', 4],
  [{ id: 'x5', name: 'Mystery', difficulty: undefined }, 'medium', null],
  [{ id: 'x6', name: 'Long-haul charter', difficulty: 'Medium', category: 'Passengers & cargo' }, 'medium', 2],
];
for (const [m, wantDiff, wantTier] of future) {
  const d = Prog.difficultyOf(m.difficulty);
  const cat = Menus.missionCategory(m);
  const tier = Prog.categoryTier(cat).tier;
  const max = Prog.maxPayout(m);
  ok(`a new mission "${m.name}" (${m.difficulty}, ${m.category || 'no category'}) is priced from its fields`,
    d.id === wantDiff && (wantTier == null || tier === wantTier) && max > 0 && max % 10 === 0,
    `${d.label} in ${cat} (tier ${tier}): up to ${max}`);
}
const unknownHeading = Prog.categoryTier('a-heading-nobody-has-made');
ok('a heading nobody has placed pays as Jobs until somebody does', unknownHeading.name === 'Jobs');

/* ---- 7. crashing, and the score --------------------------------------- */

const wallet = () => ({ credits: 500, earned: 900, best: [], unlocked: [], redeemed: [] });
{
  const p = wallet();
  const r = Prog.award(p, { kind: 'mission', score: 100, crashed: true, mission: carrier.def });
  ok('a crash pays nothing and takes nothing away', r.credits === 0 && p.credits === 500 && p.earned === 900 && r.max === carrier.normal, JSON.stringify(r));
}
{
  let last = -1;
  let rising = true;
  for (let s = 0; s <= 100; s += 5) {
    const v = Prog.payoutFor(carrier.normal, s);
    if (v < last || v > carrier.normal) rising = false;
    last = v;
  }
  ok('a better score never pays less, and never more than the most', rising);
  ok('a perfect run pays the most exactly; finishing at all pays 40%',
    Prog.payoutFor(carrier.normal, 100) === carrier.normal && Prog.payoutFor(carrier.normal, 0) === Math.round(carrier.normal * Prog.SCORE_FLOOR / 5) * 5
      && Prog.payoutFor(carrier.normal, 140) === carrier.normal && Prog.payoutFor(carrier.normal, -20) === Prog.payoutFor(carrier.normal, 0),
    `0 → ${Prog.payoutFor(carrier.normal, 0)}, 75 → ${Prog.payoutFor(carrier.normal, 75)}, 100 → ${Prog.payoutFor(carrier.normal, 100)}`);
}

/* ---- 8. each call site's shape ---------------------------------------- */

{
  // main.js: every runner mission — plane, heli, boat, car — with the def flown.
  for (const id of ['circuit', 'stackrescue', 'long-tow', 'summit', 'carrierqual', 'deadstick', 'fire-ridge']) {
    const r = priced.find((x) => x.id === id);
    const p = wallet();
    const out = Prog.award(p, { kind: 'mission', score: 100, difficulty: 'normal', label: r.name, mission: r.def, game: r.game });
    ok(`main.js: ${r.game} "${r.name}" (${r.diff}, ${r.cat}) pays its most on a perfect run`, out.credits === r.normal && out.max === r.normal && p.credits === 500 + r.normal && p.earned === 900 + r.normal, `+${out.credits} of ${out.max}`);
  }
  const p = wallet();
  const easy = Prog.award(p, { kind: 'mission', score: 100, difficulty: 'easy', mission: carrier.def });
  ok('main.js: the settings difficulty still scales it', easy.max === carrier.easy && easy.credits === carrier.easy, `${easy.credits} on Easy`);
  const school = Prog.award(wallet(), { kind: 'tutorial', score: 100 });
  ok('main.js: flight school pays as a Medium lesson', school.max === Prog.maxPayout({ difficulty: 'Medium' }, { category: 'training' }), `up to ${school.max}`);
  // rocket.js: missions and free launches, category Space, settings ignored.
  const rm = priced.find((r) => r.id === 'rocket-barge');
  const rocket = Prog.award(wallet(), { kind: 'mission', score: 100, difficulty: 'realistic', mission: ROCKET_MISSIONS.find((m) => m.id === 'rocket-barge'), category: 'space', game: 'rocket' });
  ok('rocket.js: a rocket mission pays as Space and ignores the settings', rocket.max === rm.normal, `${rocket.credits} of ${rocket.max}`);
  const freeLaunch = Prog.award(wallet(), { kind: 'free', score: 100, category: 'space', game: 'rocket' });
  const cheapest = Math.min(...priced.map((r) => r.normal));
  ok('rocket.js: a free launch pays a little — less than any mission', freeLaunch.max > 0 && freeLaunch.max < cheapest, `up to ${freeLaunch.max}; cheapest mission ${cheapest}`);
  // hijack.js: the story the dice bring, priced as the two hijack missions.
  const film = Prog.award(wallet(), { kind: 'mission', score: 100, mission: { difficulty: 'Medium', category: 'events' } });
  const real = Prog.award(wallet(), { kind: 'mission', score: 100, mission: { difficulty: 'Hard', category: 'events' } });
  ok('hijack.js: the film hijack pays as Hijacked!, the real one as By the Book',
    film.max === priced.find((r) => r.id === 'event-hijack').normal && real.max === priced.find((r) => r.id === 'event-hijack-real').normal, `${film.max} / ${real.max}`);
  const row = Prog.debriefPayRow(film);
  ok('the debrief row says what it paid and the most', /\+\d/.test(row) && row.includes(`of up to ${film.max}`), row.replace(/<[^>]+>/g, ''));
  ok('a crash gets no money row at all', Prog.debriefPayRow({ credits: 0, max: 300 }) === '');
  ok('the card line reads "Up to N credits"', Prog.payLine(380) === 'Up to 380 credits');
}

/* ---- 9. the economy ---------------------------------------------------- */

/*
 * A typical kid: Normal settings, scores about 75, flies what is open without
 * the passcode in the order a kid meets it (easy first), then round again.
 * A run takes its par time (five minutes where there is none). Before = the
 * old flat 120 + 2.2 × score.
 */
const SCORE = 75;
const before = Math.round(120 + SCORE * 2.2);
const civ = priced.filter((r) => r.cat !== 'military').sort((a, b) => a.rank - b.rank);
const mil = priced.filter((r) => r.cat === 'military');
const minutes = (r) => (r.def.parTime || 300) / 60;
function toAfford(cost, path, payOf) {
  let have = 0;
  let n = 0;
  let mins = 0;
  while (have < cost && n < 10000) {
    const r = path[n % path.length];
    have += payOf(r);
    mins += minutes(r);
    n++;
  }
  return { n, mins: Math.round(mins) };
}
const afterPay = (r) => Prog.payoutFor(r.normal, SCORE);
const beforePay = () => before;
const shop = [...Prog.UNLOCKS.map((u) => ({ id: u.aircraft, cost: u.cost, military: !!u.military }))];
if (!shop.some((u) => u.id === 'tpose')) shop.push({ id: 'tpose', cost: HARRISON, military: false });
const civShop = shop.filter((u) => !u.military).sort((a, b) => a.cost - b.cost);
const milShop = shop.filter((u) => u.military);
const civTotal = civShop.reduce((s, u) => s + u.cost, 0);
const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
const lines = [];
const fmt = (o) => `${o.n} runs / ${o.mins} min`;
const targets = [
  ['first plane (cheapest)', civShop[0].cost],
  ['Vanguard', shop.find((u) => u.id === 'vanguard').cost],
  ['priciest plane', civShop[civShop.length - 1].cost],
  ['every civilian plane', civTotal],
];
/*
 * Two kids. EASY-FIRST works up the board from the gentlest missions, which is
 * the slow way now and was not before. A MIX flies whatever catches their eye
 * — the board's own order, round and round, every difficulty in turn.
 */
const mixPath = [...civ].sort((a, b) => a.tier - b.tier || a.id.localeCompare(b.id));
const mixed = [];
for (let i = 0; mixed.length < mixPath.length; i++) {
  // Deal the board out like cards so the difficulties interleave.
  for (let k = i; k < mixPath.length; k += 7) if (!mixed.includes(mixPath[k])) mixed.push(mixPath[k]);
}
const res = {};
lines.push(`  ${''.padEnd(24)} ${'cost'.padStart(9)}   ${'before'.padEnd(27)} ${'after, easy-first'.padEnd(21)} after, a mix`);
for (const [name, cost] of targets) {
  const b = toAfford(cost, civ, beforePay);
  const a = toAfford(cost, civ, afterPay);
  const m = toAfford(cost, mixed, afterPay);
  res[name] = { b, a, m };
  lines.push(`  ${name.padEnd(24)} ${String(cost).padStart(6)} cr   ${fmt(b).padEnd(27)} ${fmt(a).padEnd(21)} ${fmt(m)}`);
}
// The military shop, once the passcode is in: the kid now flies everything.
const milPath = [...civ, ...mil].sort((a, b) => a.rank - b.rank);
const milTotal = milShop.reduce((s, u) => s + u.cost, 0);
const mb = toAfford(milTotal, milPath, beforePay);
const ma = toAfford(milTotal, milPath, afterPay);
const mm = toAfford(milTotal, [...mixed, ...mil], afterPay);
lines.push(`  ${'every military jet'.padEnd(24)} ${String(milTotal).padStart(6)} cr   ${fmt(mb).padEnd(27)} ${fmt(ma).padEnd(21)} ${fmt(mm)}`);
for (const rk of Prog.RANKS.filter((x) => !x.granted && x.at > 0)) {
  const b = toAfford(rk.at, civ, beforePay);
  const a = toAfford(rk.at, civ, afterPay);
  const m = toAfford(rk.at, mixed, afterPay);
  lines.push(`  ${`rank ${rk.name}`.padEnd(24)} ${String(rk.at).padStart(6)} xp   ${fmt(b).padEnd(27)} ${fmt(a).padEnd(21)} ${fmt(m)}`);
}
const avgAfter = mean(civ.map(afterPay));
const perMinBefore = mean(civ.map((r) => before / minutes(r)));
const perMinAfter = mean(civ.map((r) => afterPay(r) / minutes(r)));
console.log(`\nEconomy, typical kid (Normal, score ${SCORE}, ${civ.length} missions open without the passcode):`);
console.log(`  per run          before ${before}   after ${Math.round(avgAfter)} on average (${Math.min(...civ.map(afterPay))}–${Math.max(...civ.map(afterPay))})`);
console.log(`  per minute       before ${Math.round(perMinBefore)}   after ${Math.round(perMinAfter)}`);
console.log(lines.join('\n'));

ok('the average run pays about what it did (within 15%)', Math.abs(avgAfter / before - 1) <= 0.15, `${Math.round(avgAfter)} vs ${before}`);
ok('nothing is instantly affordable: the cheapest plane takes three runs or more', res['first plane (cheapest)'].a.n >= 3, fmt(res['first plane (cheapest)'].a));
ok('no single run on Normal below Very hard buys the cheapest plane',
  priced.filter((r) => r.rank < Prog.difficultyRank('Very hard')).every((r) => r.normal < civShop[0].cost),
  `dearest below Very hard: ${Math.max(...priced.filter((r) => r.rank < Prog.difficultyRank('Very hard')).map((r) => r.normal))} vs ${civShop[0].cost}`);
ok('nothing is out of reach: the priciest plane in under 20 runs, the whole civilian hangar in under 80',
  res['priciest plane'].a.n < 20 && res['every civilian plane'].a.n < 80, `${fmt(res['priciest plane'].a)}; ${fmt(res['every civilian plane'].a)}`);
ok('the whole hangar takes about as long as it did (0.8–1.25× the runs), whichever way you fly it',
  res['every civilian plane'].a.n / res['every civilian plane'].b.n >= 0.8 && res['every civilian plane'].a.n / res['every civilian plane'].b.n <= 1.25
    && res['every civilian plane'].m.n / res['every civilian plane'].b.n >= 0.8 && res['every civilian plane'].m.n / res['every civilian plane'].b.n <= 1.25,
  `easy-first ${(res['every civilian plane'].a.n / res['every civilian plane'].b.n).toFixed(2)}×, a mix ${(res['every civilian plane'].m.n / res['every civilian plane'].b.n).toFixed(2)}×`);
ok('one dear plane: a mix of missions gets it about as fast as before; sticking to the easy ones is slower, not out of reach (≤ 1.5×)',
  res['priciest plane'].m.n / res['priciest plane'].b.n <= 1.25 && res['priciest plane'].a.n / res['priciest plane'].b.n <= 1.5,
  `a mix ${(res['priciest plane'].m.n / res['priciest plane'].b.n).toFixed(2)}×, easy-first ${(res['priciest plane'].a.n / res['priciest plane'].b.n).toFixed(2)}×`);

/* ---- the table --------------------------------------------------------- */

console.log('\nDifficulty ranks:  ' + Prog.DIFFICULTIES.map((d) => `${d.rank} ${d.label} (${d.pay})`).join(' · '));
console.log('Category tiers:    ' + Prog.CATEGORY_TIERS.map((t) => `${t.tier} ${t.name} ×${t.mult} [${t.categories.join(', ')}]`).join(' · '));
console.log('Settings:          ' + Object.entries(Prog.SETTINGS_PAY).map(([k, v]) => `${k} ×${v}`).join(' · ') + `; score: ${Prog.SCORE_FLOOR * 100}% for finishing + the rest by score`);
if (TABLE) {
  console.log('\ngame    mission                difficulty  heading     tier  easy  normal  realistic');
  for (const r of [...priced].sort((a, b) => a.tier - b.tier || a.rank - b.rank || a.id.localeCompare(b.id))) {
    console.log(`${r.game.padEnd(7)} ${r.id.padEnd(22)} ${String(r.diff).padEnd(11)} ${r.cat.padEnd(11)} ${String(r.tier).padStart(4)}  ${String(r.easy).padStart(4)}  ${String(r.normal).padStart(6)}  ${String(r.realistic).padStart(9)}`);
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

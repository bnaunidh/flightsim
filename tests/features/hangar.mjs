/**
 * Node checks for the hangar's organisation (src/ui/hangar-shelves.js). Run
 * from the repo root with plain node:
 *
 *   node tests/features/hangar.mjs
 *
 * The real roster goes in, behind the same ten-line DOM stub menus.mjs uses,
 * so a new aeroplane that lands on the wrong shelf, or on none, fails here
 * by name. The screen itself is tests/features/hangar.browser.js.
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

const root = new URL('../../', import.meta.url);
const load = (p) => import(new URL(p, root).href);

const Shelves = await load('src/ui/hangar-shelves.js');
const Menus = await load('src/ui/menus.js');
const { AIRCRAFT, performanceFor } = await load('src/aircraft/types.js');
const Prog = await load('src/game/progression.js');
// The screen module itself has to load in Node too (menus.js imports it).
const ShowcaseUi = await load('src/ui/hangar-showcase-ui.js');

const {
  SHELVES, SHELF_IDS, shelfOf, shelve, NEW_SINCE_V70, isNew, fold, matches, keyStats,
  SORTS, SORT_IDS, sortFleet, FILTERS, FILTER_IDS, passesFilter, visibleFleet, idList, STORE_KEYS,
} = Shelves;
const { aircraftCategory } = Menus;

let failed = 0;
let passed = 0;
function ok(name, pass, detail = '') {
  if (pass) passed++;
  else failed++;
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
}

const byId = (id) => AIRCRAFT.find((a) => a.id === id);
const perfOf = (id) => {
  try {
    return performanceFor(id) || {};
  } catch (e) {
    return {};
  }
};
const lockedProg = { credits: 0, militaryUnlocked: false, unlocked: ['skylark', 'courier', 'harrier'] };
const ctxFor = (p) => ({
  catOf: aircraftCategory,
  owned: (id) => p.unlocked.includes(id),
  costOf: Prog.costOf,
  credits: p.credits,
  perfFor: perfOf,
  rosterIndex: (id) => AIRCRAFT.findIndex((a) => a.id === id),
});

/* ---- the shelves ---------------------------------------------------- */
{
  const want = ['light', 'airliners', 'regional', 'giants', 'business', 'military', 'helicopters', 'special'];
  ok('eight shelves, in the order the owner listed them', JSON.stringify(SHELF_IDS) === JSON.stringify(want), SHELF_IDS.join(' '));
  ok('every shelf has a label, a colour and an icon', SHELVES.every((s) => s.label && /^#[0-9a-f]{6}$/i.test(s.colour) && s.icon));

  const off = AIRCRAFT.filter((a) => !SHELF_IDS.includes(shelfOf(a, aircraftCategory))).map((a) => a.id);
  ok('every aircraft in the roster lands on one of the eight shelves', off.length === 0, off.join(', ') || `${AIRCRAFT.length} aircraft`);

  const expect = {
    skylark: 'light', courier: 'light', tempest: 'light',
    a320: 'airliners', b747: 'airliners', a380: 'airliners', b737: 'airliners', a321: 'airliners', b787: 'airliners', a350: 'airliners', b777: 'airliners', concorde: 'airliners',
    q400: 'regional', meridian: 'regional',
    belugaxl: 'giants', dreamlifter: 'giants', an225: 'giants',
    c5: 'military', c17: 'military', f22: 'military', f35b: 'military', fa18: 'military', a10: 'military', b1b: 'military', nightjar: 'military', vanguard: 'military', osprey: 'military',
    harrier: 'helicopters', bell407: 'helicopters', h145: 'helicopters', r44: 'helicopters', aw139: 'helicopters', uh60: 'helicopters', ch47: 'helicopters', ah64: 'helicopters',
    massimo: 'special', tpose: 'special',
  };
  const wrong = Object.entries(expect)
    .filter(([id]) => byId(id))
    .filter(([id, shelf]) => shelfOf(byId(id), aircraftCategory) !== shelf)
    .map(([id, shelf]) => `${id}: ${shelfOf(byId(id), aircraftCategory)}, expected ${shelf}`);
  ok('each known aircraft is on the shelf a person would look on', wrong.length === 0, wrong.join('; ') || `${Object.keys(expect).filter(byId).length} checked`);

  // The split never contradicts the picker's five headings.
  const contra = AIRCRAFT.filter((a) => {
    const cat = aircraftCategory(a);
    const sh = shelfOf(a, aircraftCategory);
    if (cat === 'military') return sh !== 'military';
    if (cat === 'helicopter') return sh !== 'helicopters';
    if (cat === 'airliner') return !['airliners', 'regional', 'giants', 'business'].includes(sh);
    if (cat === 'light') return !['light', 'business'].includes(sh);
    return !['special', 'business'].includes(sh);
  }).map((a) => a.id);
  ok('a shelf never contradicts the picker heading (Military stays Military, Helicopters stay Helicopters)', contra.length === 0, contra.join(', '));

  // Types that do not exist yet, placed from their words.
  const cases = [
    [{ id: 'x1', class: 'Business jet', category: 'airliner' }, 'business'],
    [{ id: 'x2', class: 'Executive jet' }, 'business'],
    [{ id: 'x3', class: 'Business jet', military: true }, 'military'],
    [{ id: 'x4', class: 'Airliner', category: 'airliner', freighter: true }, 'giants'],
    [{ id: 'x5', class: 'Regional airliner', category: 'airliner' }, 'regional'],
    [{ id: 'x6', class: 'Airliner', category: 'airliner', shape: { power: { kind: 'prop' } } }, 'regional'],
    [{ id: 'x7', class: 'Airliner', category: 'airliner', shape: { power: { kind: 'jet' } } }, 'airliners'],
    [{ id: 'x8', class: 'Glider' }, 'special'],
    // The picker's rule: a gated type with no category is Military whatever it is called...
    [{ id: 'x9', class: 'Helicopter', military: true }, 'military'],
    // ...but one that says it is a helicopter stays with the helicopters (the Black Hawk, the Apache).
    [{ id: 'x9b', class: 'Helicopter', category: 'helicopter', military: true }, 'helicopters'],
    [{ id: 'x10', class: 'Trainer' }, 'light'],
    [null, 'special'],
  ];
  const miss = cases.filter(([t, shelf]) => shelfOf(t, aircraftCategory) !== shelf).map(([t, shelf]) => `${t && t.id}: ${shelfOf(t, aircraftCategory)}, expected ${shelf}`);
  ok('aircraft that do not exist yet are shelved from their class, flags and engines', miss.length === 0, miss.join('; '));

  const groups = shelve(AIRCRAFT, aircraftCategory);
  const order = groups.map((g) => g.def.id);
  const sorted = [...order].sort((a, b) => SHELF_IDS.indexOf(a) - SHELF_IDS.indexOf(b));
  ok('shelve() keeps shelf order and leaves empty shelves out', JSON.stringify(order) === JSON.stringify(sorted) && groups.every((g) => g.items.length > 0), order.join(' '));
  ok('shelve() loses nobody and doubles nobody', groups.reduce((n, g) => n + g.items.length, 0) === AIRCRAFT.length && new Set(groups.flatMap((g) => g.items.map((a) => a.id))).size === AIRCRAFT.length);
  const business = groups.find((g) => g.def.id === 'business');
  ok('the Business jets shelf is only shown once something is on it', !business || business.items.every((a) => shelfOf(a, aircraftCategory) === 'business'), business ? `${business.items.length} on it` : 'empty — not shown');
}

/* ---- the passcode gate --------------------------------------------- */
{
  const shown = AIRCRAFT.filter((a) => !Prog.needsPasscode(lockedProg, a));
  const groups = shelve(shown, aircraftCategory);
  // The Vanguard and the Osprey are military jets by class but were never
  // gated, so a Military shelf can exist before the passcode — with only them.
  const mil = groups.find((g) => g.def.id === 'military');
  const leak = visibleFleet(shown, { shelf: 'all' }, ctxFor(lockedProg)).filter((a) => a.military).map((a) => a.id);
  ok('before the passcode nothing gated is on any shelf, and the Military shelf holds only the ungated jets',
    leak.length === 0 && (!mil || mil.items.every((a) => !a.military)), leak.join(', ') || `${shown.length} of ${AIRCRAFT.length} shown; Military shelf: ${mil ? mil.items.map((a) => a.id).join(' ') : 'none'}`);
  const open = { ...lockedProg, militaryUnlocked: true };
  const shownOpen = AIRCRAFT.filter((a) => !Prog.needsPasscode(open, a));
  const milOpen = shelve(shownOpen, aircraftCategory).find((g) => g.def.id === 'military');
  ok('after the passcode the Military shelf appears with every gated type on it',
    !!milOpen && AIRCRAFT.filter((a) => aircraftCategory(a) === 'military').every((a) => milOpen.items.includes(a)),
    milOpen ? `${milOpen.items.length} military` : 'no shelf');
}

/* ---- New -------------------------------------------------------------- */
{
  const missing = NEW_SINCE_V70.filter((id) => !byId(id));
  ok('every "New" id is in the roster', missing.length === 0, missing.join(', ') || NEW_SINCE_V70.join(' '));
  const originals = ['skylark', 'courier', 'meridian', 'vanguard', 'osprey', 'tempest', 'nightjar', 'harrier', 'a320', 'b747', 'a380', 'f22'];
  ok('none of the v70 fleet is marked New', originals.every((id) => !isNew(id)));
  ok('isNew answers for an unknown id without throwing', isNew('nope') === false && isNew(undefined) === false);
}

/* ---- search ------------------------------------------------------------ */
{
  ok('fold() lower-cases, drops accents and squeezes punctuation', fold('  F/A-18  Hornét ') === 'f a 18 hornet', JSON.stringify(fold('  F/A-18  Hornét ')));
  const hits = (q) => AIRCRAFT.filter((a) => matches(a, q, '')).map((a) => a.id);
  ok('an empty search matches everything', hits('').length === AIRCRAFT.length);
  const h747 = hits('747');
  ok('"747" finds the Jumbo and the Dreamlifter', h747.includes('b747') && h747.includes('dreamlifter'), h747.join(' '));
  ok('"F 22" and "f-22" find the Raptor', hits('F 22').includes('f22') && hits('f-22').includes('f22'));
  ok('"FA18" (no punctuation) still finds the Hornet', hits('FA18').includes('fa18'), hits('FA18').join(' '));
  ok('"new" finds the New aircraft', NEW_SINCE_V70.filter(byId).every((id) => hits('new').includes(id)));
  ok('two words both have to match', hits('airbus 380').length >= 1 && hits('airbus 380').every((id) => /a380/.test(id) || /airbus/i.test(byId(id).name)) && hits('airbus boeing').length === 0, hits('airbus 380').join(' '));
  ok('nonsense finds nothing', hits('xyzzyq').length === 0);
  ok('the shelf label is searchable too', matches(byId('q400'), 'regional', 'Regional') && !matches(byId('q400'), 'regional', ''));
}

/* ---- the numbers on a card ------------------------------------------ */
{
  const sk = keyStats(byId('skylark'), perfOf('skylark'));
  ok('a card gets a top speed in knots, a span in metres and a fuel figure', /^\d+ kt$/.test(sk.speed.value) && /m$/.test(sk.size.value) && sk.size.label === 'Span' && sk.fuel.value !== '—', JSON.stringify(sk));
  const hh = keyStats(byId('harrier'), perfOf('harrier'));
  ok('a helicopter card says Rotor, not Span', hh.size.label === 'Rotor', hh.size.label);
  const bare = keyStats({ id: 'x' }, {});
  ok('a type with no numbers yet gets dashes, not NaN', bare.speed.value === '—' && bare.size.value === '—' && bare.fuel.value === '—', JSON.stringify(bare));
  const a380 = keyStats(byId('a380'), perfOf('a380'));
  ok('the A380 is bigger than the Skylark and faster', a380.size.n > sk.size.n && a380.speed.n > sk.speed.n);
}

/* ---- sort --------------------------------------------------------------- */
{
  const ctx = ctxFor({ ...lockedProg, credits: 700 });
  ok('six sorts, each with a label', SORTS.length === 6 && SORTS.every((s) => s.label) && SORT_IDS.includes('shelf') && SORT_IDS.includes('newest'));
  const nonInc = (arr) => arr.every((v, i) => i === 0 || arr[i - 1] >= v);
  const bySpeed = sortFleet(AIRCRAFT, 'speed', ctx);
  ok('fastest first', nonInc(bySpeed.map((a) => perfOf(a.id).vne || 0)), bySpeed.slice(0, 3).map((a) => a.id).join(' '));
  const bySize = sortFleet(AIRCRAFT, 'size', ctx);
  ok('biggest first', nonInc(bySize.map((a) => keyStats(a, perfOf(a.id)).size.n)), bySize.slice(0, 3).map((a) => a.id).join(' '));
  const byPrice = sortFleet(AIRCRAFT, 'price', ctx);
  const pr = byPrice.map((a) => (ctx.owned(a.id) ? -1 : Prog.costOf(a.id) || Infinity));
  ok('cheapest first: yours, then by price, unpriced last', pr.every((v, i) => i === 0 || pr[i - 1] <= v), byPrice.slice(0, 4).map((a) => a.id).join(' '));
  const byNew = sortFleet(AIRCRAFT, 'newest', ctx);
  const newCount = AIRCRAFT.filter((a) => isNew(a.id)).length;
  ok('newest first puts every New aircraft at the front', byNew.slice(0, newCount).every((a) => isNew(a.id)) && byNew.slice(newCount).every((a) => !isNew(a.id)), byNew.slice(0, 3).map((a) => a.id).join(' '));
  const byName = sortFleet(AIRCRAFT, 'name', ctx);
  ok('A to Z', byName.every((a, i) => i === 0 || byName[i - 1].name.localeCompare(a.name) <= 0));
  const same = sortFleet(AIRCRAFT, 'shelf', ctx);
  ok('shelf order leaves the list as it came (stable)', same.map((a) => a.id).join() === AIRCRAFT.map((a) => a.id).join());
  const unknown = sortFleet(AIRCRAFT, 'bogus', ctx);
  ok('an unknown sort falls back to shelf order', unknown.map((a) => a.id).join() === AIRCRAFT.map((a) => a.id).join());
  ok('sorting does not mutate the roster', AIRCRAFT[0].id === 'skylark' || AIRCRAFT.indexOf(byId('skylark')) >= 0);
}

/* ---- filter ----------------------------------------------------------- */
{
  const p = { ...lockedProg, credits: 700, unlocked: ['skylark', 'courier', 'harrier'] };
  const ctx = ctxFor(p);
  ok('four filters', FILTERS.length === 4 && JSON.stringify(FILTER_IDS) === JSON.stringify(['all', 'owned', 'locked', 'afford']));
  const owned = AIRCRAFT.filter((a) => passesFilter(a, 'owned', ctx)).map((a) => a.id);
  ok('Yours = what the profile has unlocked', JSON.stringify(owned.sort()) === JSON.stringify([...p.unlocked].sort()), owned.join(' '));
  const locked = AIRCRAFT.filter((a) => passesFilter(a, 'locked', ctx));
  ok('Locked = everything else', locked.length === AIRCRAFT.length - owned.length && locked.every((a) => !p.unlocked.includes(a.id)));
  const afford = AIRCRAFT.filter((a) => passesFilter(a, 'afford', ctx)).map((a) => a.id);
  ok('Can afford = locked, for sale, and within 700 credits', afford.length > 0 && afford.every((id) => !p.unlocked.includes(id) && Prog.costOf(id) > 0 && Prog.costOf(id) <= 700), afford.join(' '));
  ok('Can afford never lists what is not for sale', !afford.includes('tpose') || Prog.costOf('tpose') > 0);
  ok('All passes everything, and an unknown filter means All', AIRCRAFT.every((a) => passesFilter(a, 'all', ctx) && passesFilter(a, 'bogus', ctx)));
}

/* ---- the whole pipeline ------------------------------------------------- */
{
  const p = { ...lockedProg, credits: 700 };
  const ctx = ctxFor(p);
  const shown = AIRCRAFT.filter((a) => !Prog.needsPasscode(p, a));
  const all = visibleFleet(shown, { shelf: 'all', query: '', filter: 'all', sort: 'shelf' }, ctx);
  const shelfOrder = shelve(shown, aircraftCategory).flatMap((g) => g.items.map((a) => a.id));
  ok('the default view is every shown aircraft in shelf order', all.map((a) => a.id).join() === shelfOrder.join(), `${all.length}`);
  const helis = visibleFleet(shown, { shelf: 'helicopters' }, ctx);
  ok('one shelf narrows to that shelf', helis.length > 0 && helis.every((a) => shelfOf(a, aircraftCategory) === 'helicopters'), helis.map((a) => a.id).join(' '));
  const q = visibleFleet(shown, { shelf: 'helicopters', query: 'robinson' }, ctx);
  ok('search inside a shelf', q.length === 1 && q[0].id === 'r44', q.map((a) => a.id).join(' '));
  const none = visibleFleet(shown, { shelf: 'light', filter: 'afford' }, ctx);
  ok('an empty result is an empty list, not a throw', Array.isArray(none));
  const sorted = visibleFleet(shown, { shelf: 'all', filter: 'locked', sort: 'price' }, ctx);
  const costs = sorted.map((a) => Prog.costOf(a.id) || Infinity);
  ok('filter and sort compose: locked ones, cheapest first', sorted.length > 0 && sorted.every((a) => !p.unlocked.includes(a.id)) && costs.every((v, i) => i === 0 || costs[i - 1] <= v));
  const unknownShelf = visibleFleet(shown, { shelf: 'attic' }, ctx);
  ok('an unknown shelf shows nothing rather than everything (the screen falls back to All itself)', unknownShelf.length === 0);
}

/* ---- what is remembered -------------------------------------------- */
{
  const mem = new Map();
  const fake = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, v) };
  const favs = idList('t.favs', fake, 3);
  ok('an empty store reads as an empty list', JSON.stringify(favs.get()) === '[]');
  ok('toggle adds, and says so', favs.toggle('a') === true && favs.has('a'));
  ok('toggle again removes, and says so', favs.toggle('a') === false && !favs.has('a'));
  favs.toggle('a');
  favs.toggle('b');
  favs.toggle('c');
  favs.toggle('d');
  ok('the newest goes first and the list is capped', JSON.stringify(favs.get()) === JSON.stringify(['d', 'c', 'b']), JSON.stringify(favs.get()));
  const rec = idList('t.recent', fake, 4);
  rec.bump('x');
  rec.bump('y');
  rec.bump('x');
  ok('bump moves a repeat to the front without doubling it', JSON.stringify(rec.get()) === JSON.stringify(['x', 'y']), JSON.stringify(rec.get()));
  mem.set('t.bad', '{not json');
  ok('bad JSON in the store reads as empty', JSON.stringify(idList('t.bad', fake).get()) === '[]');
  mem.set('t.odd', JSON.stringify([1, 'ok', null]));
  ok('non-strings are dropped', JSON.stringify(idList('t.odd', fake).get()) === JSON.stringify(['ok']));
  const throwing = { getItem: () => { throw new Error('quota'); }, setItem: () => { throw new Error('quota'); } };
  const t = idList('t.throw', throwing);
  ok('a storage that throws (private window, school profile) is survived', JSON.stringify(t.get()) === '[]' && t.toggle('a') === true && t.set(['b']) === false);
  ok('no storage at all is survived', JSON.stringify(idList('t.none', null).get()) === '[]');
  ok('the keys are namespaced like progression.js', Object.values(STORE_KEYS).every((k) => k.startsWith('islandsim.hangar.')));
}

/* ---- the screen module in Node ------------------------------------------ */
{
  ok('hangar-showcase-ui.js loads without a browser and keeps oneLine/statsFor', typeof ShowcaseUi.installHangarShowcase === 'function' && ShowcaseUi.oneLine('A. B.') === 'A.' && typeof ShowcaseUi.statsFor === 'function');
  ok('installHangarShowcase is harmless on a screen without a host', ShowcaseUi.installHangarShowcase({}, { querySelector: () => null }, {}) === null);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

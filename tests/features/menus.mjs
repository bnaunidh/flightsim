/**
 * Node checks for the categories. Run from the repo root with plain node:
 *
 *   node tests/features/menus.mjs
 *
 * menus.js is imported for real, behind the smallest DOM stub that lets the
 * modules under it load (they paint canvases at import time). Nothing here
 * builds a screen — tests/features/menus.browser.js does that in the page.
 *
 * What is checked is the part that has to hold for aircraft and missions that
 * do not exist yet: seven aeroplanes and three kinds of mission are being
 * built in parallel, so most of these feed in entries shaped like theirs and
 * check where they land.
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

const Menus = await load('src/ui/menus.js');
const GameUi = await load('src/ui/game-ui.js');
const { AIRCRAFT } = await load('src/aircraft/types.js');
const { MISSIONS, gameOf } = await load('src/game/missions.js');

const {
  aircraftCategory, missionCategory, categoryDef, groupByCategory, categoryItemData,
  AIRCRAFT_CATEGORIES, MISSION_CATEGORIES,
} = Menus;

let failed = 0;
let passed = 0;
function ok(name, pass, detail = '') {
  if (pass) passed++;
  else failed++;
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
}

const AC_IDS = AIRCRAFT_CATEGORIES.map((c) => c.id);
const MI_IDS = MISSION_CATEGORIES.map((c) => c.id);

/* ---- the roster as it stands ------------------------------------- */
{
  const bad = AIRCRAFT.filter((a) => !AC_IDS.includes(aircraftCategory(a))).map((a) => `${a.id}→${aircraftCategory(a)}`);
  ok('every aeroplane in the roster lands on one of the five headings', bad.length === 0, bad.join(', ') || `${AIRCRAFT.length} aircraft`);
  const want = { skylark: 'light', courier: 'light', tempest: 'light', meridian: 'airliner', vanguard: 'military', osprey: 'military', nightjar: 'military', harrier: 'helicopter' };
  const wrong = Object.entries(want)
    .filter(([id, cat]) => AIRCRAFT.some((a) => a.id === id) && aircraftCategory(AIRCRAFT.find((a) => a.id === id)) !== cat)
    .map(([id, cat]) => `${id} expected ${cat}`);
  ok('the original eight go where their class says', wrong.length === 0, wrong.join(', '));
}

/* ---- the seven being built ---------------------------------------- */
{
  const cases = [
    [{ id: 'f22', class: 'Fighter', category: 'military', military: true }, 'military'],
    [{ id: 'f35b', class: 'Fighter', category: 'military', military: true }, 'military'],
    [{ id: 'fa18', class: 'Carrier fighter', category: 'military', military: true }, 'military'],
    [{ id: 'massimo', class: 'Aerobatic', category: 'special' }, 'special'],
    [{ id: 'b747', class: 'Airliner', category: 'airliner', longHaul: true }, 'airliner'],
    [{ id: 'a380', class: 'Airliner', category: 'airliner', longHaul: true }, 'airliner'],
    [{ id: 'a320', class: 'Airliner', category: 'airliner' }, 'airliner'],
    // No category at all: placed from the class.
    [{ id: 'x1', class: 'Stealth fighter' }, 'military'],
    [{ id: 'x2', class: 'Bomber' }, 'military'],
    [{ id: 'x3', class: 'Jumbo jet' }, 'airliner'],
    [{ id: 'x4', class: 'Helicopter' }, 'helicopter'],
    [{ id: 'x5', class: 'Trainer' }, 'light'],
    [{ id: 'x6', class: 'Glider' }, 'special'],
    [{ id: 'x7' }, 'special'],
    // Behind the passcode is military, whatever it is called.
    [{ id: 'x8', class: 'Trainer', military: true }, 'military'],
    // A category written the way people write it.
    [{ id: 'x9', class: 'Trainer', category: 'Airliners' }, 'airliner'],
    [{ id: 'x10', category: 'Helicopters' }, 'helicopter'],
    [{ id: 'x11', class: 'Airliner', category: 'spaceship' }, 'airliner'],
  ];
  const bad = cases.filter(([t, want]) => aircraftCategory(t) !== want).map(([t, want]) => `${t.id}: ${aircraftCategory(t)} ≠ ${want}`);
  ok('aeroplanes added later land where the contract says', bad.length === 0, bad.join('; ') || `${cases.length} cases`);
}

/* ---- the missions as they stand ------------------------------------ */
{
  const stray = MISSIONS.filter((m) => !m.category && !MI_IDS.includes(missionCategory(m))).map((m) => m.id);
  ok('every mission without its own category lands on a listed heading', stray.length === 0, stray.join(', ') || `${MISSIONS.length} missions`);
  const want = {
    circuit: 'training', delivery: 'delivery', storm: 'training', deadstick: 'events', medevac: 'rescue',
    emberrun: 'challenge', chaser: 'challenge', tail: 'challenge',
    carrierqual: 'military', patrol: 'military', recon: 'military', range: 'military',
    firstlight: 'training', overboard: 'rescue', 'first-shout': 'rescue', 'long-tow': 'rescue',
    firstrun: 'training', shuttle: 'delivery', nightcall: 'rescue',
  };
  const wrong = Object.entries(want)
    .filter(([id]) => MISSIONS.some((m) => m.id === id && !m.category))
    .filter(([id, cat]) => missionCategory(MISSIONS.find((m) => m.id === id)) !== cat)
    .map(([id, cat]) => `${id}: ${missionCategory(MISSIONS.find((m) => m.id === id))} ≠ ${cat}`);
  ok('the existing missions sit where they were read to belong', wrong.length === 0, wrong.join('; '));
  const gatedOutside = MISSIONS.filter((m) => m.military && !m.category && missionCategory(m) !== 'military').map((m) => m.id);
  ok('every passcode mission without a category is under Military', gatedOutside.length === 0, gatedOutside.join(', '));
}

/* ---- the missions being built -------------------------------------- */
{
  const cases = [
    [{ id: 'm1', name: 'A', category: 'goofy' }, 'goofy'],
    [{ id: 'm2', name: 'B', category: 'events' }, 'events'],
    [{ id: 'm3', name: 'C', category: 'meteor' }, 'meteor'],
    [{ id: 'm4', name: 'D', category: 'airline' }, 'airline'],
    [{ id: 'm5', name: 'E', category: 'Emergencies' }, 'events'],
    [{ id: 'm6', name: 'F', category: 'deliveries' }, 'delivery'],
    [{ id: 'm7', name: 'G', category: 'Passengers & cargo' }, 'airline'],
    // No category: the passcode, the aeroplane, then the words.
    [{ id: 'm8', name: 'Top Secret', military: true }, 'military'],
    [{ id: 'm9', name: 'Night Run', aircraft: 'nightjar' }, 'military'],
    [{ id: 'm10', name: 'Meteor Shower', short: 'Rocks from space' }, 'meteor'],
    [{ id: 'm11', name: 'Squawk 7500', short: 'Hijack' }, 'events'],
    [{ id: 'm12', name: 'Pizza Run', short: 'Deliver the pizza' }, 'delivery'],
    [{ id: 'm13', name: 'Jumbo to the Cay', short: 'Four hundred passengers' }, 'airline'],
    [{ id: 'm14', name: 'Something Else Entirely' }, 'challenge'],
  ];
  const bad = cases.filter(([m, want]) => missionCategory(m) !== want).map(([m, want]) => `${m.id}: ${missionCategory(m)} ≠ ${want}`);
  ok('missions added later land where the contract says', bad.length === 0, bad.join('; ') || `${cases.length} cases`);

  const odd = missionCategory({ id: 'm15', name: 'Loop', category: 'stunts' });
  const def = categoryDef('missions', odd);
  ok('an unlisted category keeps a heading of its own', odd === 'stunts' && def.label === 'Stunts', `${odd} / ${def.label}`);
}

/* ---- the wildfire missions (game/extra/fire.js) ------------------------ */
{
  /*
   * Forest fires to put out, in the aeroplane and the helicopter. Whatever
   * the fire team types into `category`, and if they type nothing, the name
   * is enough — but a fire ON BOARD is still an emergency, not firefighting.
   */
  const cases = [
    [{ id: 'f1', name: 'A', category: 'fire', game: 'heli' }, 'fire'],
    [{ id: 'f2', name: 'B', category: 'firefighting' }, 'fire'],
    [{ id: 'f3', name: 'C', category: 'Wildfire' }, 'fire'],
    [{ id: 'f4', name: 'D', category: 'forest-fires' }, 'fire'],
    [{ id: 'f5', name: 'Forest Fire at Ember Ridge', game: 'heli' }, 'fire'],
    [{ id: 'f6', name: 'Water Bomber', short: 'Scoop the bay, drop on the ridge' }, 'fire'],
    [{ id: 'f7', name: 'Fire on Board', short: 'Get it down, now' }, 'events'],
    [{ id: 'f8', name: 'Engine Fire', short: 'Shut it down and land' }, 'events'],
    [{ id: 'f9', name: 'E', category: 'rescue' }, 'rescue'],
  ];
  const bad = cases.filter(([m, want]) => missionCategory(m) !== want).map(([m, want]) => `${m.id}: ${missionCategory(m)} ≠ ${want}`);
  ok('wildfire missions go under Firefighting, a fire on board stays an emergency', bad.length === 0, bad.join('; ') || `${cases.length} cases`);
  const def = categoryDef('missions', 'fire');
  const rank = MISSION_CATEGORIES.findIndex((c) => c.id === 'fire');
  ok('Firefighting is a listed heading with its own icon and colour, above Military',
    def.label === 'Firefighting' && def.icon === 'fire' && !def.extra && rank >= 0
      && rank < MISSION_CATEGORIES.findIndex((c) => c.id === 'military'),
    `${def.label} / ${def.icon} / ${def.colour}`);
}

/* ---- grouping ------------------------------------------------------ */
{
  const items = [
    { id: 'a', category: 'military' }, { id: 'b', category: 'stunts' }, { id: 'c', category: 'training' },
    { id: 'd', category: 'training' }, { id: 'e', category: 'meteor' },
  ];
  const groups = groupByCategory('missions', items, missionCategory);
  const order = groups.map((g) => g.def.id).join(',');
  ok('headings sort in list order, unlisted ones just above Military', order === 'training,meteor,stunts,military', order);
  const flat = groups.flatMap((g) => g.items.map((x) => x.id)).sort().join('');
  ok('grouping keeps every item exactly once', flat === 'abcde', flat);
  ok('grouping leaves out empty headings', groups.every((g) => g.items.length > 0));

  // The whole roster and the whole board, the way the screens build them.
  const allA = groupByCategory('fleet', AIRCRAFT, aircraftCategory).flatMap((g) => g.items);
  const allM = groupByCategory('missions', MISSIONS, missionCategory).flatMap((g) => g.items);
  ok('the picker grouping holds every aeroplane once', allA.length === AIRCRAFT.length && new Set(allA).size === AIRCRAFT.length, `${allA.length}/${AIRCRAFT.length}`);
  ok('the board grouping holds every mission once', allM.length === MISSIONS.length && new Set(allM).size === MISSIONS.length, `${allM.length}/${MISSIONS.length}`);
}

/* ---- search words and the counted line ----------------------------- */
{
  const sky = AIRCRAFT.find((a) => a.id === 'skylark');
  const d = sky && categoryItemData('fleet', sky);
  ok('search words carry the name, the id and the heading', !!d && d.find.includes('skylark') && d.find.includes('light aircraft'), d && d.find.slice(0, 60));
  const n = MISSIONS.filter((m) => gameOf(m) === 'flight' && !m.military).length;
  const line = GameUi.missionsLine('flight', { militaryUnlocked: false });
  const words = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve',
    'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen', 'Twenty'];
  ok('the Missions card line is counted, not written', line.startsWith(`${n < words.length ? words[n] : n} mission`), line);
  const withCode = GameUi.missionsLine('flight', { militaryUnlocked: true });
  const m = MISSIONS.filter((x) => gameOf(x) === 'flight').length;
  ok('the passcode changes the count', withCode.startsWith(`${m < words.length ? words[m] : m} mission`), withCode);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

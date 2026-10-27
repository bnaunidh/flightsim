/**
 * Node checks for the two editions (src/core/edition.js). Run from the repo
 * root with plain node:
 *
 *   node tests/features/edition.mjs
 *
 * The owner: "remove tpose harrison and air massimo from thankdapro.github".
 * The same files are published to bnaunidh.github.io/flightsim and to
 * thankdapro.github.io/flightsim; on the thankdapro copy T-Pose Harrison
 * ('tpose') and Air Massimo ('massimo') must not exist from the player's
 * point of view, and everywhere else nothing changes.
 *
 * The edition is read once, when the page loads, so each address is checked
 * in a node of its own: this file runs itself again with --child=<address>,
 * the child loads the whole game's modules (features/index.js too) under that
 * `location` and reports what a player could meet, and the parent compares.
 *
 *   1. editionOf(): thankdapro* hosts and ?edition=thankdapro are the
 *      thankdapro edition, nothing turns it off there, everything else is full.
 *   2. thankdapro.github.io: neither id (nor either name) in the roster, the
 *      hangar's headings and shelves, the shop, the achievements and their
 *      Full House / Hangar Full counts, the traffic, the key list, the owner's
 *      troll row, the drag chute and self-destruct lines; no tpose extension.
 *      A saved pick of either falls back to the trainer, quietly; a remote in
 *      either is hit (and drawn) as the stand-in jet; Harrison-ify is a no-op.
 *   3. bnaunidh.github.io and localhost: all of the above exactly as before —
 *      the same roster in the same order, both in the shop, both
 *      achievements, the keys, the troll.
 *   4. The thankdapro roster is the full one minus exactly those two, in order.
 */

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const childArg = process.argv.find((a) => a.startsWith('--child='));

if (childArg) {
  await child(childArg.slice('--child='.length));
} else {
  await parent();
}

/* ------------------------------------------------------------------ */
/* The child: one address, the whole game's modules                    */
/* ------------------------------------------------------------------ */

async function child(address) {
  const u = new URL(address);
  globalThis.location = { hostname: u.hostname, search: u.search, protocol: u.protocol, href: u.href, pathname: u.pathname };
  global.document = {
    createElement: () => ({
      getContext: () => new Proxy({}, { get: () => () => ({ addColorStop() {}, data: new Uint8ClampedArray(4) }) }),
      width: 0,
      height: 0,
      style: {},
    }),
    body: { appendChild() {} },
  };
  const store = new Map();
  globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
  const warnings = [];
  const warn = console.warn;
  console.warn = (...a) => {
    warnings.push(a.map(String).join(' '));
  };
  const root = new URL('../../', import.meta.url);
  const load = (p) => import(new URL(p, root).href);

  await load('src/features/index.js');
  const E = await load('src/core/edition.js');
  const T = await load('src/aircraft/types.js');
  const Prog = await load('src/game/progression.js');
  const Ach = await load('src/features/achievements/data.js');
  const Rules = await load('src/features/achievements/rules.js');
  const Store = await load('src/features/achievements/store.js');
  const I = await load('src/flight/input.js');
  const Menus = await load('src/ui/menus.js');
  const Shelves = await load('src/ui/hangar-shelves.js');
  const P = await load('src/features/traffic/planner.js');
  const X = await load('src/game/extensions.js');
  const K = await load('src/features/knockdown.js');
  const DC = await load('src/features/eject/dragchute.js');
  const Trolls = await load('src/features/owner/trolls.js');
  const Fx = await load('src/features/owner/fx.js');

  const ids = T.AIRCRAFT.map((a) => a.id);
  const names = T.AIRCRAFT.map((a) => a.name);
  const groups = Menus.groupByCategory('fleet', T.AIRCRAFT, Menus.aircraftCategory).map((g) => ({ id: g.def.id, items: g.items.map((a) => a.id) }));
  let shelves = [];
  try {
    shelves = Shelves.shelve(T.AIRCRAFT, Menus.aircraftCategory).map((g) => ({ id: g.def.id, items: g.items.map((a) => a.id) }));
  } catch (e) {
    shelves = [{ id: 'error', items: [String(e)] }];
  }
  const military = P.typesFor({ military: true, length: 4000, slots: [{ maxSpan: 999, maxLength: 999 }] }).map((t) => t.id);

  warnings.length = 0;
  const pickT = T.getAircraft('tpose').id;
  const pickM = T.getAircraft('massimo').id;
  const pickWarnings = warnings.slice();
  warnings.length = 0;

  // An achievements store that has flown both.
  const st = Store.blank();
  const got = [...Rules.applyEvent(st, 'liftoff', { aircraft: 'tpose', speedKts: 400 }), ...Rules.applyEvent(st, 'liftoff', { aircraft: 'massimo', speedKts: 400 })];

  const actionText = Object.entries(I.ACTIONS).map(([k, a]) => `${k} ${a.label}`).join('\n');
  const grouped = I.groupedActions('plane').flatMap((g) => g.items.map((it) => `${it.key} ${it.label}`)).join('\n');
  const profM = K.profileOf('massimo');
  const profF = K.profileOf('f22');
  const trollRow = Trolls.trollsDebug().row({ id: 7, name: 'Pat' });

  const out = {
    address,
    edition: E.EDITION,
    hidden: [...E.HIDDEN_AIRCRAFT],
    ids,
    names,
    groups,
    shelves,
    military,
    unlocks: Prog.UNLOCKS.map((u) => u.aircraft),
    unlockWhy: Prog.UNLOCKS.map((u) => u.why).join('\n'),
    costM: Prog.costOf('massimo'),
    costT: Prog.costOf('tpose'),
    achievements: Ach.ACHIEVEMENTS.map((a) => a.id),
    achText: Ach.ACHIEVEMENTS.map((a) => `${a.name} ${a.how}`).join('\n'),
    landable: Ach.ALL_LANDABLE_AIRCRAFT,
    everyPlaneTarget: (Ach.ACHIEVEMENTS.find((a) => a.id === 'every-plane') || {}).progress?.target,
    unlockedOnLiftoff: got,
    actions: Object.keys(I.ACTIONS),
    actionText,
    grouped,
    extensions: X.extStatus().map((e) => e.id),
    pickT,
    pickM,
    pickWarnings,
    visibleT: E.visibleAircraftId('tpose'),
    visibleF: E.visibleAircraftId('f22'),
    standInSame: !!(profM && profF && profM === profF),
    profM: !!profM,
    chuteNone: DC.chuteWords('none'),
    trollRow,
    harrisonFor: Fx.harrisonFor('t', { add() {} }) !== null,
  };
  console.warn = warn;
  process.stdout.write('\n@@RESULT@@' + JSON.stringify(out) + '\n');
}

/* ------------------------------------------------------------------ */
/* The parent: every address, compared                                 */
/* ------------------------------------------------------------------ */

async function parent() {
  const results = [];
  const ok = (name, pass, detail = '') => results.push({ name, pass: !!pass, detail: String(detail) });

  /* 1. editionOf, pure */
  const E = await import(new URL('../../src/core/edition.js', import.meta.url).href);
  ok('node itself (no location) is the full edition, nothing hidden', E.EDITION === 'full' && E.HIDDEN_AIRCRAFT.size === 0, `${E.EDITION} [${[...E.HIDDEN_AIRCRAFT]}]`);
  const cases = [
    [{ hostname: 'thankdapro.github.io', search: '' }, 'thankdapro'],
    [{ hostname: 'THANKDAPRO.github.io', search: '' }, 'thankdapro'],
    [{ hostname: 'thankdapro.github.io', search: '?edition=full' }, 'thankdapro'],
    [{ hostname: 'bnaunidh.github.io', search: '' }, 'full'],
    [{ hostname: 'bnaunidh.github.io', search: '?edition=thankdapro' }, 'thankdapro'],
    [{ hostname: 'localhost', search: '' }, 'full'],
    [{ hostname: 'localhost', search: '?dev=1&edition=thankdapro' }, 'thankdapro'],
    [{ hostname: '127.0.0.1', search: '?edition=bogus' }, 'full'],
    [{ hostname: 'notthankdapro.example', search: '' }, 'full'],
    [undefined, 'full'],
    [null, 'full'],
    [{}, 'full'],
  ];
  const wrong = cases.filter(([loc, want]) => E.editionOf(loc) !== want).map(([loc, want]) => `${JSON.stringify(loc)} -> ${E.editionOf(loc)} (want ${want})`);
  ok('editionOf: thankdapro* hosts and ?edition=thankdapro are thankdapro; nothing turns it off; the rest full', !wrong.length, wrong.join('; ') || `${cases.length} cases`);
  ok('hiddenAircraftFor(thankdapro) is exactly tpose + massimo', [...E.hiddenAircraftFor({ hostname: 'thankdapro.github.io' })].sort().join() === 'massimo,tpose');
  ok('the stand-in for a remote in a hidden type is a real roster jet', E.STAND_IN === 'f22');

  /* 2-4. each address in its own node */
  const run = (address) => {
    const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url), `--child=${address}`], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    const line = (r.stdout || '').split('\n').find((l) => l.startsWith('@@RESULT@@'));
    if (!line) return { error: `${address}: exit ${r.status}\n${(r.stderr || '').slice(-2000)}` };
    return JSON.parse(line.slice('@@RESULT@@'.length));
  };
  const th = run('https://thankdapro.github.io/flightsim/');
  const bn = run('https://bnaunidh.github.io/flightsim/');
  const lh = run('http://localhost:8000/');
  const lhq = run('http://localhost:8000/?edition=thankdapro');
  for (const x of [th, bn, lh, lhq]) if (x.error) ok('child ran', false, x.error);

  const NAMES = /massimo|harrison|t-pose/i;
  const has = (list, id) => Array.isArray(list) && list.includes(id);
  const none = (list) => !has(list, 'tpose') && !has(list, 'massimo');

  for (const [label, x] of [['thankdapro.github.io', th], ['localhost?edition=thankdapro', lhq]]) {
    if (x.error) continue;
    ok(`${label}: the thankdapro edition, hiding exactly tpose + massimo`, x.edition === 'thankdapro' && x.hidden.sort().join() === 'massimo,tpose', `${x.edition} [${x.hidden}]`);
    ok(`${label}: neither is in the roster`, none(x.ids), x.ids.join(','));
    ok(`${label}: no roster name says Massimo or Harrison`, !x.names.some((n) => NAMES.test(n)), x.names.filter((n) => NAMES.test(n)).join(', '));
    ok(`${label}: neither under any hangar heading, and no empty heading (Special had only them)`, x.groups.every((g) => none(g.items) && g.items.length) && !x.groups.some((g) => g.id === 'special'), JSON.stringify(x.groups.map((g) => g.id)));
    ok(`${label}: neither on any hangar shelf`, x.shelves.every((g) => none(g.items) && g.id !== 'error'), JSON.stringify(x.shelves));
    ok(`${label}: neither in the shop, and neither has a price`, none(x.unlocks) && !x.costM && !x.costT && !NAMES.test(x.unlockWhy), `${x.unlocks.join(',')} M=${x.costM} T=${x.costT}`);
    ok(`${label}: neither achievement is on the page, and nothing on it names them`, !has(x.achievements, 'tpose-up') && !has(x.achievements, 'massimo-fast') && !NAMES.test(x.achText), x.achievements.filter((a) => /tpose|massimo/.test(a)).join());
    ok(`${label}: flying them could not unlock one (there is nothing to fly, and nothing to unlock)`, !x.unlockedOnLiftoff.some((a) => /tpose|massimo/.test(a)), x.unlockedOnLiftoff.join());
    ok(`${label}: "Hangar Full" counts only aeroplanes this copy has`, none(x.landable) && x.landable.every((id) => has(x.ids, id)) && x.everyPlaneTarget === x.landable.length, `${x.landable.length} / target ${x.everyPlaneTarget}`);
    ok(`${label}: Air Massimo is not in the air base's traffic`, none(x.military) && x.military.length > 0, x.military.join(','));
    ok(`${label}: no Harrison keys and no drag chute key in Settings, and no key label names them`, !has(x.actions, 'harrisonSpin') && !has(x.actions, 'harrisonBoost') && !has(x.actions, 'dragChute') && !NAMES.test(x.actionText) && !NAMES.test(x.grouped), (x.actionText.match(/.*(massimo|harrison).*/gi) || []).join(' | '));
    ok(`${label}: the tpose feature is not plugged in`, !has(x.extensions, 'tpose'), x.extensions.length + ' extensions');
    ok(`${label}: a saved pick of either is the trainer, without a warning`, x.pickT === 'skylark' && x.pickM === 'skylark' && x.visibleT === 'skylark' && x.visibleF === 'f22' && !x.pickWarnings.length, `${x.pickT} ${x.pickM} ${x.pickWarnings.join(' | ')}`);
    ok(`${label}: a remote player in Air Massimo is hit like the stand-in jet (not skipped, not a crash)`, x.profM && x.standInSame);
    ok(`${label}: the drag chute line does not name them`, !NAMES.test(x.chuteNone), x.chuteNone);
    ok(`${label}: the owner's troll row has no Harrison-ify, and an incoming one has nothing to draw`, !/Harrison/i.test(x.trollRow) && /Barrel roll/.test(x.trollRow) && !x.harrisonFor, x.trollRow.slice(0, 120));
  }

  for (const [label, x] of [['bnaunidh.github.io', bn], ['localhost', lh]]) {
    if (x.error) continue;
    ok(`${label}: the full edition, nothing hidden`, x.edition === 'full' && x.hidden.length === 0, `${x.edition} [${x.hidden}]`);
    ok(`${label}: both are in the roster, named`, has(x.ids, 'tpose') && has(x.ids, 'massimo') && x.names.includes('T-Pose Harrison') && x.names.includes('Air Massimo'));
    ok(`${label}: both under Special`, x.groups.some((g) => g.id === 'special' && has(g.items, 'tpose') && has(g.items, 'massimo')), JSON.stringify(x.groups.map((g) => g.id)));
    ok(`${label}: both in the shop at their prices`, has(x.unlocks, 'massimo') && has(x.unlocks, 'tpose') && x.costM === 3600 && x.costT === 3601, `M=${x.costM} T=${x.costT}`);
    ok(`${label}: both achievements, and both unlock`, has(x.achievements, 'tpose-up') && has(x.achievements, 'massimo-fast') && has(x.unlockedOnLiftoff, 'tpose-up') && has(x.unlockedOnLiftoff, 'massimo-fast'), x.unlockedOnLiftoff.join());
    // (Air Massimo is a Special, and the planner skips Specials, so it never joined the traffic: the same list, below.)
    ok(`${label}: the air base's traffic is the real jets`, has(x.military, 'f22') && x.military.length >= 5, x.military.join(','));
    ok(`${label}: Harrison's keys and the drag chute key are in Settings`, has(x.actions, 'harrisonSpin') && has(x.actions, 'harrisonBoost') && has(x.actions, 'dragChute'));
    ok(`${label}: the tpose feature is plugged in`, has(x.extensions, 'tpose'));
    ok(`${label}: picking either flies it`, x.pickT === 'tpose' && x.pickM === 'massimo' && x.visibleT === 'tpose');
    ok(`${label}: a remote in Air Massimo is hit as Air Massimo`, x.profM && !x.standInSame);
    ok(`${label}: the drag chute line still names them`, /Air Massimo and T-Pose Harrison/.test(x.chuteNone), x.chuteNone);
    ok(`${label}: the owner's troll row has Harrison-ify`, /Harrison-ify/.test(x.trollRow));
  }

  if (!th.error && !bn.error && !lh.error) {
    const minus = bn.ids.filter((id) => id !== 'tpose' && id !== 'massimo');
    ok('thankdapro\'s roster is the full one minus exactly the two, in the same order', JSON.stringify(th.ids) === JSON.stringify(minus), `${th.ids.length} vs ${bn.ids.length}`);
    ok('bnaunidh and localhost are identical everywhere checked', JSON.stringify({ ...bn, address: '' }) === JSON.stringify({ ...lh, address: '' }));
    ok('the air base\'s traffic is the same on both copies', JSON.stringify(th.military) === JSON.stringify(bn.military), `${th.military} vs ${bn.military}`);
    const shopMinus = bn.unlocks.filter((id) => id !== 'tpose' && id !== 'massimo');
    ok('thankdapro\'s shop is the full one minus exactly the two', JSON.stringify(th.unlocks) === JSON.stringify(shopMinus), th.unlocks.join(','));
    const achMinus = bn.achievements.filter((id) => id !== 'tpose-up' && id !== 'massimo-fast');
    ok('thankdapro\'s achievements are the full list minus exactly the two', JSON.stringify(th.achievements) === JSON.stringify(achMinus));
    ok('thankdapro\'s keys are the full list minus exactly harrisonSpin, harrisonBoost and dragChute', JSON.stringify(th.actions) === JSON.stringify(bn.actions.filter((k) => !['harrisonSpin', 'harrisonBoost', 'dragChute'].includes(k))));
  }

  let failed = 0;
  for (const r of results) {
    if (!r.pass) failed++;
    console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.detail && !r.pass ? `  — ${r.detail}` : ''}`);
  }
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
}

/**
 * Node checks for "start in the sky with 80% fuel". Run from anywhere:
 *
 *   node tests/features/air-fuel.mjs [--verbose]
 *
 * The owner: "on a mission, if you're in the sky you should join with like
 * 80 percent fuel so it's more realistic". So a mission whose spawn has a
 * height (`spawn.altAGL`) starts at AIRBORNE_START_FUEL, one that starts on a
 * runway, a stand or a pad keeps full tanks, and a mission may say otherwise
 * with `spawn.fuel`. This checks three things:
 *
 * START — every aircraft mission (the board's, and both campaign files)
 * gets the fuel it should from missionStartFuel(), which is what startMode
 * hands reset(). Running on Fumes still gets its scripted 9 litres from its
 * own onStart, which runs after the aeroplane is placed.
 *
 * BUDGET — nobody can run dry before a mission can be finished. For every
 * airborne mission, the burn is MEASURED on the real flight model in node
 * (its type, full power, engine on, realistic fuel on and off), and the
 * minutes that leaves in the tank from the start fuel must be at least half
 * as much again as the longest the mission realistically takes: its clock
 * if it has one; for a fire, as long as the fire.mjs bots give that
 * difficulty or twice par, whichever is longer; otherwise twice par. A
 * mission that cannot meet it must carry its own `spawn.fuel`, and this
 * names it.
 *
 * The browser half (air-fuel.browser.js) starts real missions through
 * startMode and checks the gauge, a retry and Free Flight's own picker.
 *
 * Exits non-zero if anything fails.
 */

if (typeof globalThis.window === 'undefined') {
  const mem = new Map();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) },
  });
}
globalThis.document = {
  createElement: () => ({
    getContext: () => new Proxy({}, { get: () => () => ({ addColorStop() {}, data: new Uint8ClampedArray(4) }) }),
    width: 0,
    height: 0,
    style: {},
  }),
  body: { appendChild() {} },
};

const root = new URL('../../', import.meta.url);
const imp = (p) => import(new URL(p, root).href);

const results = [];
const ok = (name, pass, detail = '') => {
  results.push({ name, pass: !!pass, detail: String(detail) });
  return !!pass;
};

const THREE = await imp('src/vendor/three.module.js');
const { MISSIONS, gameOf, RUNWAY_START, AIRBORNE_START_FUEL, missionStartFuel } = await imp('src/game/missions.js');
const { CAMPAIGN_PART_A } = await imp('src/game/campaign.js');
const { CAMPAIGN_PART_B } = await imp('src/game/campaign-b.js');
const { specFor } = await imp('src/aircraft/types.js');
const { Weather } = await imp('src/world/weather.js');
const T = await imp('src/world/terrain.js');
const P = await imp('src/aircraft/physics.js');

/* ----------------------------------------------------------------- start -- */

ok('the airborne start is 80% of a full tank', AIRBORNE_START_FUEL === 0.8, AIRBORNE_START_FUEL);
ok('spawn.fuel overrides it in the air', missionStartFuel({ altAGL: 500, fuel: 0.55 }) === 0.55);
ok('spawn.fuel overrides it on the ground too', missionStartFuel({ pos: null, fuel: 0.3 }) === 0.3);
ok('spawn.fuel is a fraction of a tank, kept between 5% and full', missionStartFuel({ altAGL: 500, fuel: 9 }) === 1 && missionStartFuel({ fuel: 0 }) === 0.05);
ok('no spawn at all is the runway, with full tanks', missionStartFuel(undefined) === 1 && missionStartFuel(RUNWAY_START) === 1);

/** What startMode flies a mission in when it names no aeroplane. */
const typeOf = (m) => m.aircraft || (gameOf(m) === 'heli' ? 'harrier' : 'skylark');
const aircraftMissions = [
  ...MISSIONS.filter((m) => gameOf(m) === 'flight' || gameOf(m) === 'heli').map((m) => ['board', m]),
  ...CAMPAIGN_PART_A.map((m) => ['campaign', m]),
  ...CAMPAIGN_PART_B.map((m) => ['campaign-b', m]),
];
const airborne = [];
let grounded = 0;
for (const [where, m] of aircraftMissions) {
  // A spawn's height can be a getter that reads the map, as startMode does after loading it.
  T.applyMap(m.map || 'kestrel');
  const spawn = m.spawn || RUNWAY_START;
  const inAir = spawn.altAGL != null;
  const want = spawn.fuel != null ? Math.max(0.05, Math.min(1, spawn.fuel)) : inAir ? AIRBORNE_START_FUEL : 1;
  const got = missionStartFuel(spawn);
  ok(`${where} ${m.id}: starts ${inAir ? 'in the air' : 'on the ground'} with ${Math.round(want * 100)}% fuel`, got === want, `${got}`);
  if (inAir) airborne.push({ where, m, start: got, type: typeOf(m), alt: Math.round(spawn.altAGL + Math.min(0, T.heightAt(spawn.pos.x, spawn.pos.z))) });
  else grounded++;
}
const onBoard = airborne.filter((a) => a.where === 'board').length;
ok('the board has airborne missions to check (and ground ones)', onBoard >= 20 && grounded >= 20, `${onBoard} in the air, ${grounded} on the ground`);

// Running on Fumes: placed at 80% like every airborne start, then its own
// onStart puts the leak's 9 litres in — and that is what it flies on.
{
  const lowFuel = CAMPAIGN_PART_B.find((m) => m.id === 'low-fuel');
  const cap = specFor('skylark').fuelCapacity;
  const ac = { fuel: cap * missionStartFuel(lowFuel.spawn) };
  const said = [];
  lowFuel.onStart({ ac, data: {}, sim: { notify: (t) => said.push(t), scene: null, _campaignProps: [] } });
  ok('campaign-b low-fuel: keeps its own scripted 9 litres', ac.fuel === 9, `${ac.fuel} L of ${cap}`);
}

/* ---------------------------------------------------------------- budget -- */

/**
 * Litres a second at full power, engine running, measured on the real flight
 * model: the aeroplane is put in the air, flown flat out for thirty seconds
 * and the drop in the tank divided by the time. Realistic fuel is the flat
 * 1% every thirty seconds; off, it is the type's own full-power burn.
 */
const burnCache = new Map();
function measuredBurn(id, realistic) {
  const key = `${id}/${realistic}`;
  if (burnCache.has(key)) return burnCache.get(key);
  T.applyMap('kestrel');
  P.applyAircraft(id);
  const ac = new P.Aircraft();
  const w = new Weather();
  w.load({ time: 'day', condition: 'clear', windSpeedKts: 0, windDirDeg: 90 });
  ac.mode = 'simplified';
  ac.realisticFuel = realistic;
  ac.reset({ pos: new THREE.Vector3(-9000, 0, 6000), headingDeg: 90, speed: 70, altAGL: 1200, engineOn: true, gearDown: false, fuel: 0.8 });
  const f0 = ac.fuel;
  const STEP = 1 / 120;
  let t = 0;
  for (; t < 30 && !ac.crashed && ac.engineOn; t += STEP) {
    ac.controls.throttle = 1;
    ac.update(STEP, w);
  }
  const lps = (f0 - ac.fuel) / t;
  const out = { lps, frac: lps / specFor(id).fuelCapacity, flew: !ac.crashed && ac.engineOn };
  burnCache.set(key, out);
  return out;
}

const FIRE_BOT_LIMIT = { Easy: 360, Medium: 900, Hard: 1200 }; // tests/features/fire.mjs
function minutesNeeded(m) {
  if (m.timeLimit) return { s: m.timeLimit, why: 'its clock' };
  const par = m.parTime || 0;
  if (String(m.id).startsWith('fire-')) {
    const s = Math.max(FIRE_BOT_LIMIT[m.difficulty] || 900, 2 * par);
    return { s, why: 'the fire bots, or twice par' };
  }
  if (par) return { s: 2 * par, why: 'twice par' };
  // The meteor missions keep no par: three minutes of dodging, a few waves,
  // one photograph. Meteor Shower never ends; it is a Free Flight with stars.
  return { s: 900, why: 'no par: a quarter of an hour' };
}

// Running out is the point of this one: its onStart leaves it 9 litres and a leak.
const SCRIPTED_FUEL = new Set(['low-fuel']);
const rows = [];
for (const a of airborne) {
  if (SCRIPTED_FUEL.has(a.m.id)) continue;
  const need = minutesNeeded(a.m);
  const on = measuredBurn(a.type, true);
  const off = measuredBurn(a.type, false);
  const minOn = a.start / on.frac / 60;
  const minOff = a.start / off.frac / 60;
  const worst = Math.min(minOn, minOff);
  const needMin = need.s / 60;
  rows.push(`${a.where.padEnd(10)} ${a.m.id.padEnd(18)} ${a.type.padEnd(8)} ${String(a.alt).padStart(5)} m  start ${Math.round(a.start * 100)}%  `
    + `ON ${minOn.toFixed(0).padStart(3)} min  OFF ${minOff.toFixed(0).padStart(4)} min  needs ${needMin.toFixed(1).padStart(4)} min (${need.why})`);
  ok(`${a.where} ${a.m.id}: the ${a.type} flies flat out on the real model while the burn is measured`, on.flew && off.flew);
  ok(`${a.where} ${a.m.id}: flat out from ${Math.round(a.start * 100)}%, fuel outlasts the mission by half again (realistic fuel on and off)`,
    worst >= needMin * 1.5, `${worst.toFixed(1)} min of fuel, ${needMin.toFixed(1)} min needed`);
}
// The model the numbers rest on: realistic fuel is 1% every thirty seconds.
{
  const s = measuredBurn('skylark', true);
  ok('realistic fuel burns 1% of the tank every 30 s at any power', Math.abs(s.frac * 30 - 0.01) < 0.0005, `${(s.frac * 3000).toFixed(3)}% per 30 s`);
}

/* ---------------------------------------------------------------- report -- */

if (process.argv.includes('--verbose')) console.log(rows.join('\n') + '\n');
const failed = results.filter((r) => !r.pass);
for (const r of results) {
  if (!r.pass || process.argv.includes('--verbose')) {
    console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? `  (${r.detail})` : ''}`);
  }
}
console.log(`\nair-fuel: ${results.length - failed.length}/${results.length} passed`);
process.exitCode = failed.length ? 1 : 0;

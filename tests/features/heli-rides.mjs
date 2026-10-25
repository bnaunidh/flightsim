/**
 * The helicopter wave in multiplayer and the races, in plain node:
 *
 *   node tests/features/heli-rides.mjs
 *
 * The seven rotorcraft beside the Skyhook (aircraft/extra/helis.js: Bell
 * 407, H145, R44, AW139, UH-60, CH-47, AH-64) could be flown alone but not
 * brought anywhere: multiplayer.js rides() offered the Skyhook flat, the
 * helicopter server flew the Skyhook whatever you picked, race.js put the
 * Skyhook on the Skyhook Sprint, and loading-screens.js announced it. What
 * this proves, with the shipped code and a game object with only what those
 * read:
 *   - rides(): every helicopter the player can fly is a 'heli' ride, in the
 *     hangar's order, the Skyhook first; no rotorcraft among the planes;
 *   - rideFor('heli') follows the Hangar's pick (Rotors), the lobby screen's
 *     pick wins over it, a plane picked there leaves the helicopter alone;
 *   - a helicopter server (host or client) starts in the helicopter picked,
 *     and a plane ride on a helicopter island flies the player's helicopter;
 *   - the snapshot says 'heli' for any rotorcraft, so everybody else draws
 *     and treats an Apache as a helicopter;
 *   - the loading screen plans the join in that helicopter;
 *   - Race alone on the Skyhook Sprint starts in that helicopter, and the
 *     Ring Rally from the helicopter game in it too.
 */

global.document = {
  createElement: () => ({
    getContext: () => new Proxy({}, { get: () => () => ({ addColorStop() {}, data: new Uint8ClampedArray(4) }) }),
    width: 0,
    height: 0,
    style: {},
  }),
  body: { appendChild() {} },
  head: { appendChild() {} },
};
globalThis.window = globalThis.window || { addEventListener() {}, devicePixelRatio: 1, matchMedia: () => ({ matches: false, addEventListener() {} }) };

const results = [];
const ok = (name, pass, detail = '') => {
  results.push({ name, pass: !!pass, detail: String(detail) });
  console.log(`${pass ? 'ok  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  return !!pass;
};

const { AIRCRAFT, getAircraft, isHelicopter } = await import('../../src/aircraft/types.js');
const P = await import('../../src/features/multiplayer/protocol.js');
const { multiplayer: mp } = await import('../../src/features/multiplayer.js');
const { MapLoading } = await import('../../src/features/loading-screens.js');
const { raceAlone } = await import('../../src/features/race.js');
const RR = await import('../../src/features/race/rules.js');
const { HELI_COURSE } = await import('../../src/features/race/courses.js');

const WAVE = ['bell407', 'h145', 'r44', 'aw139', 'uh60', 'ch47', 'ah64'];
ok('the seven rotorcraft of the wave are in the hangar, and are helicopters to isHelicopter()', WAVE.every((id) => getAircraft(id).id === id && isHelicopter(getAircraft(id))) && isHelicopter(getAircraft('harrier')) && !isHelicopter(getAircraft('skylark')));

// A game object with only what rides(), enterWorld(), myState() and the planners read. Nothing is drawn.
const started = [];
const sim = {
  state: 'menu', mode: 'free', game: 'heli', settings: { map: 'kestrel', quality: 'low' }, prog: null, weather: null, hud: { notify() {} },
  menus: { chosenAircraft: 'skylark', currentGame: 'heli', setGame(g) { this.currentGame = g; }, syncMap() {} },
  aircraftType: null, aircraft: null,
  freeOpts: () => ({}),
  borrowMap(id) { sim.settings.map = id; },
  async startMode(mode, opts) {
    started.push({ mode, aircraft: opts.aircraft, game: sim.game });
    sim.aircraftType = getAircraft(opts.aircraft);
  },
  startDrive() {},
  defForMode: () => ({}),
  mapForGame: () => 'kestrel',
};
mp.sim = sim;
mp.installed = true;
mp.profile = { name: 'Brave Otter', colour: '#ff5a4f', key: 'k', chosen: true, ride: null };
mp.showHud = () => {};
mp.keepOwnMapSaved = () => {};

/* ---- rides() ----------------------------------------------------------- */
{
  const rides = mp.rides();
  const helis = rides.filter((r) => r.game === 'heli');
  const planes = rides.filter((r) => r.game === 'flight');
  const hangarHelis = AIRCRAFT.filter(isHelicopter).map((t) => t.id);
  ok('rides(): every helicopter in the hangar is a ride of the helicopter game, in the hangar’s order, the Skyhook first', helis.map((r) => r.type).join() === hangarHelis.join() && helis[0].type === 'harrier' && WAVE.every((id) => helis.some((r) => r.type === id)), helis.map((r) => r.type).join(' '));
  ok('…each a kind "heli" named "<name> helicopter", and no rotorcraft among the planes', helis.every((r) => r.kind === 'heli' && / helicopter$/.test(r.name)) && !planes.some((r) => isHelicopter(getAircraft(r.type))) && planes.length > 10);
  ok('…planes first, then the helicopters, then the boat and the car', rides.findIndex((r) => r.kind === 'heli') > rides.filter((r) => r.kind === 'plane').length - 1 && rides.at(-2).game === 'boat' && rides.at(-1).game === 'car');
  // Locked rotorcraft stay locked: an unlocked list without the Apache leaves it out; the Skyhook never goes.
  sim.prog = { unlocked: AIRCRAFT.map((t) => t.id).filter((id) => id !== 'ah64' && id !== 'harrier'), militaryUnlocked: true };
  const locked = mp.rides().filter((r) => r.game === 'heli').map((r) => r.type);
  ok('a helicopter not yet bought is not offered; the Skyhook always is', !locked.includes('ah64') && locked.includes('harrier') && locked.includes('ch47'), locked.join(' '));
  sim.prog = null;
}

/* ---- which helicopter ----------------------------------------------------- */
{
  ok('rideFor("heli") with a plane picked in the Hangar: the Skyhook', mp.rideFor('heli').type === 'harrier' && mp.ride().game === 'heli');
  sim.menus.chosenAircraft = 'ah64';
  ok('…the Apache picked in the Hangar (Rotors): the Apache', mp.rideFor('heli').type === 'ah64' && mp.ride().type === 'ah64' && mp.myHeli() === 'ah64');
  ok('setRide(): a helicopter of the wave is taken, and wins over the Hangar; one that is not a helicopter of the hangar is refused', mp.setRide({ game: 'heli', type: 'ch47' }) && mp.ride().type === 'ch47' && mp.rideFor('heli').type === 'ch47' && !mp.setRide({ game: 'heli', type: 'skylark' }) && !mp.setRide({ game: 'heli', type: 'nope' }) && mp.ride().type === 'ch47');
  ok('isHeliRide(): a rotorcraft’s heli ride yes; a plane’s, a boat’s, junk no', mp.isHeliRide({ game: 'heli', type: 'uh60' }) && !mp.isHeliRide({ game: 'heli', type: 'skylark' }) && !mp.isHeliRide({ game: 'flight', type: 'ah64' }) && !mp.isHeliRide(null));
  mp.profile.ride = null;
  sim.menus.chosenAircraft = 'r44';
  sim.aircraftType = getAircraft('h145');
  ok('with nothing picked on the lobby screen: the Hangar’s pick before the one you are in', mp.myHeli() === 'r44');
  sim.menus.chosenAircraft = 'skylark';
  ok('…and the one you are in before the Skyhook', mp.myHeli() === 'h145');
  sim.aircraftType = null;
  ok('…and the Skyhook when neither is a helicopter', mp.myHeli() === 'harrier' && mp.rideName({ game: 'heli', type: 'ah64' }) === `${getAircraft('ah64').name} helicopter`);
}

/* ---- a helicopter server ---------------------------------------------------- */
{
  const server = { name: 'Harbour Hangar', map: 'kestrel', mapName: 'Kestrel Island', game: 'heli', code: null, slot: 1, max: 5, bump: 2 };
  started.length = 0;
  await mp.enterWorld(server, null, null, { game: 'heli', type: 'uh60' });
  ok('a helicopter server, Black Hawk as the ride: starts the free flight in the Black Hawk, in the helicopter game', started.length === 1 && started[0].aircraft === 'uh60' && started[0].game === 'heli' && started[0].mode === 'free', JSON.stringify(started[0]));
  sim.menus.chosenAircraft = 'aw139';
  await mp.enterWorld(server, null, null, null);
  ok('…with no ride said (the older server list): the helicopter picked in the Hangar', started[1].aircraft === 'aw139');
  await mp.enterWorld(server, null, null, { game: 'flight', type: 'b747' });
  ok('…a plane ride on a helicopter server: the player’s helicopter, never a 747 on a helipad', started[2].aircraft === 'aw139' && started[2].game === 'heli');
  await mp.enterWorld({ ...server, game: 'flight' }, null, null, { game: 'flight', type: 'b747' });
  ok('a plane server is unchanged: the plane', started[3].aircraft === 'b747' && started[3].game === 'flight');
  sim.menus.chosenAircraft = 'skylark';
  // The join screen's plan, with the same inputs.
  const L = new MapLoading(sim);
  const plan = L.planWorld(server, { game: 'heli', type: 'ch47' }, mp);
  const plan2 = L.planWorld(server, { game: 'flight', type: 'b747' }, mp);
  ok('loading screen: a join to a helicopter server in the Chinook is planned as the Chinook in the helicopter game; a plane ride there as the player’s helicopter', plan.game === 'heli' && plan.vehicle === getAircraft('ch47').name && plan2.game === 'heli' && plan2.vehicle === getAircraft('harrier').name, `${plan.vehicle}; ${plan2.vehicle}`);
  const plan3 = L.planWorld({ ...server, game: 'flight' }, { game: 'flight', type: 'b747' }, mp);
  ok('…and a plane server in the plane', plan3.game === 'flight' && plan3.vehicle === getAircraft('b747').name);
}

/* ---- the snapshot ------------------------------------------------------------ */
{
  sim.mode = 'free';
  sim.aircraftType = getAircraft('ah64');
  sim.aircraft = { pos: { x: 1, y: 2, z: 3 }, quat: { x: 0, y: 0, z: 0, w: 1 }, vel: { x: 0, y: 0, z: 0 }, controls: {}, gearDown: true, gearPos: 1, flaps: 0, rpm: 1, onGround: false, engineOn: true, crashed: false };
  mp.meId = 3;
  const snap = P.decodeState(mp.myState(1000));
  ok('myState(): in the Apache the snapshot says game "heli", type "ah64" — everybody else draws and treats it as a helicopter', snap && snap.game === 'heli' && snap.type === 'ah64', JSON.stringify(snap && { game: snap.game, type: snap.type }));
  ok('rideNow(): the Apache is a helicopter ride', mp.rideNow().game === 'heli' && mp.rideNow().type === 'ah64');
  sim.aircraftType = getAircraft('a320');
  ok('…and an A320 a plane', P.decodeState(mp.myState(1001)).game === 'flight' && mp.rideNow().game === 'flight');
  mp.meId = null;
  sim.aircraft = null;
  sim.aircraftType = null;
}

/* ---- Race alone --------------------------------------------------------------- */
{
  // startMode is where the race hands over to the world; stopping there says which helicopter it chose.
  const picked = [];
  sim.startMode = async (mode, opts) => {
    picked.push({ aircraft: opts.aircraft, game: sim.game });
    throw Object.assign(new Error('stop here'), { code: 'stop' });
  };
  const race = async (id) => {
    try {
      await raceAlone(sim, id);
    } catch (e) {
      if (e.code !== 'stop') throw e;
    }
    return picked.at(-1);
  };
  sim.state = 'menu';
  sim.menus.chosenAircraft = 'bell407';
  mp.profile.ride = null;
  const r1 = await race(HELI_COURSE.id);
  ok('Race alone, the Skyhook Sprint, the Bell 407 picked in the Hangar: the race starts in the Bell 407, in the helicopter game', r1 && r1.aircraft === 'bell407' && r1.game === 'heli', JSON.stringify(r1));
  mp.setRide({ game: 'heli', type: 'ch47' });
  const r2 = await race(HELI_COURSE.id);
  ok('…the Chinook picked on the lobby screen wins', r2 && r2.aircraft === 'ch47' && r2.game === 'heli', JSON.stringify(r2));
  const r3 = await race(RR.COURSE.id);
  ok('…the Ring Rally from the helicopter game: in that helicopter too (it always took the helicopter)', r3 && r3.aircraft === 'ch47' && r3.game === 'heli', JSON.stringify(r3));
  mp.profile.ride = null;
  sim.menus.chosenAircraft = 'skylark';
  sim.menus.currentGame = 'flight';
  sim.game = 'flight';
  const r4 = await race(RR.COURSE.id);
  ok('…and from the plane game with a plane picked: the plane, as before', r4 && r4.aircraft === 'skylark' && r4.game === 'flight', JSON.stringify(r4));
  sim.menus.currentGame = 'heli';
  sim.game = 'heli';
  const r5 = await race(HELI_COURSE.id);
  ok('…the Skyhook Sprint with nothing picked: the Skyhook, as before', r5 && r5.aircraft === 'harrier' && r5.game === 'heli', JSON.stringify(r5));
  ok('the rules are unchanged: the helicopter race takes the helicopter game, the Ring Rally planes and helicopters', RR.rideFits(HELI_COURSE, 'heli') && !RR.rideFits(HELI_COURSE, 'flight') && RR.rideFits(RR.COURSE, 'heli') && RR.rideFits(RR.COURSE, 'flight'));
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) {
  for (const f of failed) console.log(`  FAIL ${f.name}${f.detail ? ` — ${f.detail}` : ''}`);
  process.exit(1);
}
process.exit(0);

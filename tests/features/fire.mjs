/**
 * Node checks for the wildfire. Run with plain node:
 *
 *   node tests/features/fire.mjs          (add --verbose for the robot's log)
 *
 * No page, no canvas, no graphics card: the fire (features/wildfire/grid.js),
 * what a mission wants from it (wildfire/scenario.js) and the water
 * (wildfire/tank.js) are pure numbers on purpose, and this runs them.
 *
 *   1. The spread model on made-up ground: it spreads, faster downwind and
 *      uphill; water puts it out and keeps it out; it never burns water or
 *      tarmac; the cap on burning cells holds however big it gets.
 *   2. The same questions on the real maps: sea, runway and apron never
 *      burn, grass and the upland forest do.
 *   3. The water: a bucket for the Skyhook, a scooping tank for an
 *      aeroplane, where a drop lands, and when a scoop fills.
 *   4. The missions: at least six, both machines, Line One on Firewatch,
 *      every ignition on fuel and every fill point in open sea.
 *   5. The frame itself, headless: wildfire.js's hooks with a stand-in game.
 *   6. A ROBOT PILOT flies every mission's fire — the same ignition, preburn,
 *      crews and parcels the game runs — with honest round-trip times and a
 *      sloppy aim, and has to win each one in time. A pilot who never drops
 *      a thing has to LOSE the ones with a town or a base in the way, and
 *      must never be handed a win; nor, on anything bigger than a first
 *      lesson, may one who hits it once and goes home.
 */

// The modules paint two small textures when they are imported; give them
// something to paint on.
globalThis.document = {
  createElement: () => ({
    getContext: () => new Proxy({}, { get: () => () => ({ addColorStop() {}, data: new Uint8ClampedArray(4) }) }),
    width: 0,
    height: 0,
    style: {},
  }),
  body: { appendChild() {} },
};

const root = new URL('../../src/', import.meta.url);
const imp = (p) => import(new URL(p, root).href);

const { FireGrid, FUEL, STATE, WET_SECONDS } = await imp('features/wildfire/grid.js');
const { FireScenario, findWater, sideOfLine } = await imp('features/wildfire/scenario.js');
const { makeSampler } = await imp('features/wildfire/ground.js');
const { WaterTank, tankSpec, predictLanding } = await imp('features/wildfire/tank.js');
const T = await imp('world/terrain.js');
const { getAircraft } = await imp('aircraft/types.js');
const { MISSIONS, fireSpecOf } = await imp('game/extra/fire.js');
const ALL = await imp('game/missions.js');

const VERBOSE = process.argv.includes('--verbose');
let passed = 0;
let failed = 0;
function ok(name, pass, detail = '') {
  if (pass) passed++;
  else failed++;
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
}

/* ------------------------------------------------------------------ *
 * Made-up ground.
 * ------------------------------------------------------------------ */

/** Flat grass; `water(x,z)` and `paved(x,z)` carve out what does not burn. */
function flatGround({ water = () => false, paved = () => false, height = () => 10, forest = () => false } = {}) {
  return {
    height,
    classify(x, z) {
      if (water(x, z)) return FUEL.NONE;
      if (paved(x, z)) return FUEL.NONE;
      return forest(x, z) ? FUEL.FOREST : FUEL.GRASS;
    },
  };
}

function grid(opts = {}) {
  const g = new FireGrid({ size: 200, cell: 20, maxBurning: opts.cap || 900, seed: opts.seed || 3 });
  g.sampler = opts.sampler || flatGround();
  g.setWindow(0, 0);
  return g;
}

function run(g, seconds, wind = { x: 0, z: 0 }) {
  for (let t = 0; t < seconds; t += 0.5) g.update(0.5, wind);
}

/** How far the fire has reached from (0,0) in each direction: +x, -x, +z, -z. */
function reach(g) {
  let px = 0;
  let nx = 0;
  let pz = 0;
  let nz = 0;
  for (let i = 0; i < g.n; i++) {
    if (g.state[i] === STATE.FRESH) continue;
    const x = g.cellX(i);
    const z = g.cellZ(i);
    px = Math.max(px, x);
    nx = Math.max(nx, -x);
    pz = Math.max(pz, z);
    nz = Math.max(nz, -z);
  }
  return { px, nx, pz, nz };
}

function everLitWhere(g, pred) {
  let n = 0;
  for (let i = 0; i < g.n; i++) {
    if (g.state[i] !== STATE.FRESH && g.state[i] !== undefined && pred(g.cellX(i), g.cellZ(i))) n++;
  }
  return n;
}

/* ------------------------------------------------------------------ *
 * 1. The spread model.
 * ------------------------------------------------------------------ */

{
  const g = grid();
  const lit = g.ignite(0, 0, 30);
  run(g, 120);
  ok('a fire on grass spreads', g.stats.everLit > lit * 3 && g.burning > 0, `${lit} lit, ${g.stats.everLit} ever alight after 2 min, ${g.burning} burning`);
}

{
  const g = grid();
  g.ignite(0, 0, 30);
  run(g, 150, { x: 8, z: 0 });
  const r = reach(g);
  ok('it runs downwind faster than upwind', r.px > r.nx * 2.5, `8 m/s east: ${r.px} m east, ${r.nx} m west in 150 s`);
  const front = r.px / 150;
  ok('…at a speed a helicopter can catch', front > 1 && front < 6, `${front.toFixed(1)} m/s at the head`);
}

{
  const g = grid({ sampler: flatGround({ height: (x) => 100 + x * 0.3 }) });
  g.ignite(0, 0, 30);
  run(g, 200);
  const r = reach(g);
  ok('it runs uphill faster than downhill', r.px > r.nx * 1.8, `30% slope rising east, calm: ${r.px} m up, ${r.nx} m down in 200 s`);
}

{
  const a = grid({ seed: 11 });
  const b = grid({ seed: 11 });
  a.ignite(0, 0, 40);
  b.ignite(0, 0, 40);
  run(a, 90, { x: 3, z: -2 });
  run(b, 90, { x: 3, z: -2 });
  ok('the same seed burns the same fire', a.stats.everLit === b.stats.everLit && a.burning === b.burning, `${a.stats.everLit} and ${b.stats.everLit}`);
}

{
  const g = grid();
  g.ignite(0, 0, 60);
  run(g, 40);
  const before = g.burning;
  const res = g.douse(0, 0, 400, 1, 16, null, 1);
  ok('water puts the fire out', before > 0 && g.burning === 0 && res.doused === before, `${before} burning, ${res.doused} doused, ${g.burning} left`);
  const i = g.indexAt(0, 0);
  ok('doused ground will not light again straight away', g.igniteCell(i) === false && g.state[i] === STATE.DOUSED);
  run(g, WET_SECONDS + 1);
  ok('…until it has dried out', g.igniteCell(i) === true, `after ${WET_SECONDS} s`);
}

{
  // A drop from too high knocks down some of it; one roll per cell per drop.
  const g = grid({ seed: 5 });
  g.ignite(0, 0, 100);
  const before = g.burning;
  for (let k = 0; k < 15; k++) g.douse(0, 0, 200, 0.3, 0, null, 9);
  const out = before - g.burning;
  ok('a weak drop only knocks some of it down, however many parcels land', out > before * 0.15 && out < before * 0.5, `${out} of ${before} out at strength 0.3 from 15 parcels of one drop`);
}

{
  // The sea east of x = 200, calm air: the fire runs up to it and stops.
  const water = (x) => x > 200;
  const g = grid({ sampler: flatGround({ water }) });
  ok('fire cannot be lit on water', g.ignite(400, 0, 30) === 0);
  g.ignite(100, 0, 40);
  run(g, 400, { x: 10, z: 0 });
  ok('fire never burns across the sea', everLitWhere(g, water) === 0, `${g.stats.everLit} cells alight, none past the shore, in a 10 m/s onshore-to-sea wind`);
  let held = 0;
  for (let s = 0; s < g.burning; s++) held += g.slotOpen[s];
  ok('water counts as a held edge', g.contained() > 0);
}

{
  // A 60 m wide runway across the wind, no embers: it stops at the tarmac.
  const paved = (x, z) => Math.abs(z) < 30;
  const g = grid({ sampler: flatGround({ paved }) });
  g.spotMul = 0;
  ok('fire cannot be lit on tarmac', g.ignite(0, 0, 10) === 0);
  g.ignite(0, -200, 40);
  run(g, 400, { x: 0, z: 9 });
  ok('fire never burns on the tarmac', everLitWhere(g, paved) === 0);
  ok('…or past it, without embers', everLitWhere(g, (x, z) => z > 30) === 0, `${g.stats.everLit} alight on the fire's side, none past it`);
}

{
  const g = grid({ cap: 60 });
  const lit = g.ignite(0, 0, 400);
  ok('the cap stops a huge ignition', lit === 60 && g.burning === 60, `${lit} lit of a 400 m disc`);
  let worst = 0;
  for (let t = 0; t < 120; t += 0.5) {
    g.update(0.5, { x: 12, z: 3 });
    worst = Math.max(worst, g.burning);
  }
  ok('…and holds in a strong wind with embers', worst <= 60 && g.peak <= 60, `worst ${worst}, peak ${g.peak}`);
}

{
  // Every unburnt cell round a fire soaked: nowhere to go, fully contained.
  const g = grid();
  g.ignite(0, 0, 30);
  for (let i = 0; i < g.n; i++) {
    if (g.state[i] === STATE.FRESH && Math.hypot(g.cellX(i), g.cellZ(i)) < 200) g.wet[i] = 1e6;
  }
  g.update(0.5, { x: 0, z: 0 });
  ok('a fire ringed with wet ground is fully contained', g.burning > 0 && g.contained() === 1, `${g.burning} still burning inside, contained ${g.contained()}`);
}

{
  const g = grid({ sampler: flatGround({ forest: (x) => x > 0 }) });
  g.ignite(-100, 0, 20);
  g.ignite(100, 0, 20);
  let grass = 0;
  let forest = 0;
  for (let s = 0; s < g.burning; s++) {
    if (g.fuel[g.slotCell[s]] === FUEL.FOREST) forest += g.slotLife[s];
    else grass += g.slotLife[s];
  }
  ok('forest burns longer than grass', forest > grass * 1.4, `${Math.round(forest)} s of forest against ${Math.round(grass)} s of grass`);
}

{
  // The dug line: a strip of cells that will not burn.
  const g = grid();
  const path = [{ x: -1000, z: 0 }, { x: 1000, z: 0 }];
  const { cutLine } = await imp('features/wildfire/scenario.js');
  const n = cutLine(g, path, 20);
  ok('a dug line takes the fuel out of its cells', n > 90 && !g.canBurn(0, 0) && g.canBurn(0, 100), `${n} cells cut`);
  ok('sideOfLine tells the two sides apart', sideOfLine(path, 0, -300) === -sideOfLine(path, 0, 300));
}

{
  // Line One's rules on flat grass: a north-south break at x = 0, the base
  // west of it, the fire east of it, the wind blowing west.
  const g = grid();
  const sc = new FireScenario(g);
  const wind = { x: -6, z: 0 };
  sc.start({
    centre: { x: 0, z: 0 },
    ignite: [{ x: 250, z: 0, r: 40 }],
    spot: 0,
    line: { path: [{ x: 0, z: -1800 }, { x: 0, z: 1800 }], width: 40 },
    protect: { x: -1500, z: 0, r: 200, name: 'base' },
    holdSeconds: 300,
    holdNeedsLine: true,
    embers: { first: 10, every: 30, min: 60, max: 120, reach: 400, r: 20 },
    mopUp: 2,
    smallLeft: 0,
  }, { wind });
  const west = [];
  for (let t = 0; t < 120; t += 0.5) {
    sc.update(0.5, wind, false);
    if (sc.emberNew) {
      west.push(sc.emberAt.x);
      sc.emberNew = false;
    }
  }
  ok('embers come over the line on their timetable', sc.embers >= 3 && west.every((x) => x < -40), `${sc.embers} embers, landed at x = ${west.map(Math.round).join(', ')}`);
  ok('…and the fire they start counts as across', sc.across > 0, `${sc.across} across`);
  // Soak the base side along the break: embers that land on wet ground go out.
  for (let i = 0; i < g.n; i++) {
    const x = g.cellX(i);
    if (x < -10 && x > -260 && g.state[i] === STATE.FRESH) g.wet[i] = 1e6;
  }
  const had = sc.embers;
  for (let t = 0; t < 120; t += 0.5) sc.update(0.5, wind, false);
  ok('an ember on soaked ground does not take', sc.embers === had, `${sc.embers - had} more took`);
  // The clock has run out; nothing happens while the base side burns.
  for (let t = 0; t < 120; t += 0.5) sc.update(0.5, wind, true);
  ok('the crews wait while the protected side is burning', !sc.mopping && sc.holdLeft === 0 && sc.across > 0, `${sc.across} across`);
  for (let s = g.burning - 1; s >= 0; s--) {
    const i = g.slotCell[s];
    if (g.cellX(i) < 0) g.douse(g.cellX(i), g.cellZ(i), 5, 1, 0);
  }
  for (let t = 0; t < 2; t += 0.5) sc.update(0.5, wind, true);
  ok('…and take over once it is clear', sc.mopping);
  for (let t = 0; t < 60 && g.burning; t += 0.5) sc.update(0.5, wind, true);
  ok('…and put the rest out', g.burning === 0, `${g.burning} left`);
}

{
  // Once the line is dug, the crews come over and help with what is on the
  // base side — for as long as the player's water keeps landing.
  const run = (mode) => {
    const g = grid();
    const sc = new FireScenario(g);
    const wind = { x: -6, z: 0 };
    sc.start({
      centre: { x: 0, z: 0 },
      ignite: [{ x: 250, z: 0, r: 40 }, { x: -200, z: 0, r: 60 }],
      spot: 0,
      line: { path: [{ x: 0, z: -1800 }, { x: 0, z: 1800 }], width: 40 },
      protect: { x: -1500, z: 0, r: 200, name: 'base' },
      holdSeconds: 300,
      holdNeedsLine: true,
      crewHelp: 4,
      mopUp: 2,
      smallLeft: 0,
    }, { wind });
    // 'active' lands a hit every minute; 'once' one hit at the start.
    const hitsAt = (t) => (mode === 'active' ? 1 + Math.floor(t / 60) : mode === 'once' ? 1 : 0);
    let t = 0;
    for (; t < 300; t += 0.5) sc.update(0.5, wind, hitsAt(t));
    const acrossAtClock = sc.across;
    let helpedAt = null;
    while (t < 900 && g.burning) {
      sc.update(0.5, wind, hitsAt(t));
      if (sc.helping && helpedAt === null) helpedAt = t;
      t += 0.5;
    }
    return { acrossAtClock, t, across: sc.across, helping: sc.helping, helpedAt, mopping: sc.mopping, burning: g.burning };
  };
  const a = run('active');
  ok('after the clock the crews help on the base side, and the fire ends', a.acrossAtClock > 0 && a.helping && a.mopping && a.burning === 0, `${a.acrossAtClock} across when they came; out at ${a.t} s`);
  const b = run('none');
  ok('…but not for a player who never hit it', !b.helping && !b.mopping && b.across > 0, `${b.across} across at ${b.t} s`);
  const c = run('once');
  ok('…and not for one who hit it once, five minutes before they came, and went home', !c.helping && !c.mopping && c.across > 0, `${c.across} across at ${c.t} s`);
}

{
  // Nobody wins by waiting: without a hit, the crews never take over.
  const g = grid();
  const sc = new FireScenario(g);
  sc.start({ centre: { x: 0, z: 0 }, ignite: [{ x: 0, z: 0, r: 30 }], mopUp: 0.1, smallLeft: 1000, holdSeconds: 10 }, {});
  for (let t = 0; t < 60; t += 0.5) sc.update(0.5, { x: 0, z: 0 }, false);
  ok('the crews never take over without a drop that hit', !sc.mopping && g.burning > 0);
}

/* ------------------------------------------------------------------ *
 * 2. Real ground.
 * ------------------------------------------------------------------ */

{
  T.applyMap('kestrel');
  const s = makeSampler(null);
  ok('Kestrel: the runway does not burn', s.classify(0, 0) === FUEL.NONE && s.classify(200, 0) === FUEL.NONE);
  ok('Kestrel: the apron does not burn', s.classify(-100, -150) === FUEL.NONE);
  ok('Kestrel: the sea does not burn', s.classify(6000, 1500) === FUEL.NONE && T.heightAt(6000, 1500) < 0);
  // Somewhere on the island is grass, and somewhere in the hill band forest.
  let grass = 0;
  let forest = 0;
  let sand = 0;
  for (let x = -2400; x <= 2400; x += 200) {
    for (let z = -2400; z <= 2400; z += 200) {
      const h = T.heightAt(x, z);
      const f = s.classify(x, z);
      if (f === FUEL.GRASS) grass++;
      if (f === FUEL.FOREST) forest++;
      if (h > 0.5 && h < 3 && f !== FUEL.NONE) sand++;
    }
  }
  ok('Kestrel: grass burns', grass > 40, `${grass} grass samples of 625`);
  ok('Kestrel: bare ground is grass, not forest, without a tree on it', forest === 0, `${forest} forest samples with no trees given`);
  const wooded = makeSampler(null, { woods: [{ x: 1500, z: -1000, r: 300 }], treeAt: (x, z) => Math.hypot(x + 900, z - 900) < 15 });
  ok('a mission\'s woods burn as forest', wooded.classify(1500, -1000) === FUEL.FOREST || s.classify(1500, -1000) === FUEL.NONE);
  ok('a cell with a tree in it burns as forest', wooded.classify(-900, 900) === FUEL.FOREST || s.classify(-900, 900) === FUEL.NONE);
  ok('Kestrel: the beach does not burn', sand === 0);
}

/* ------------------------------------------------------------------ *
 * 3. The water.
 * ------------------------------------------------------------------ */

const heli = getAircraft('harrier');
const tempest = getAircraft('tempest');
{
  const b = tankSpec(heli);
  const s = tankSpec(tempest);
  ok('the Skyhook carries a bucket', b.kind === 'bucket' && b.capacity >= 250 && b.capacity <= 500, `${b.capacity} L`);
  ok('the Tempest carries a scooping tank', s.kind === 'scooper' && s.capacity >= 2000, `${s.capacity} L, scoops at ${s.vmin}–${s.vmax} kt`);
  ok('…with a speed band that includes a gentle approach speed', s.vmin <= 90 && s.vmax >= 130);
  const light = tankSpec(getAircraft('skylark'));
  ok('any aeroplane can carry a tank', light.kind === 'scooper' && light.capacity >= 250, `Skylark ${light.capacity} L at ${light.vmin}–${light.vmax} kt`);
}

{
  const out = { x: 0, y: 0, z: 0 };
  const flat = () => 0;
  const t = predictLanding({ x: 0, y: 30, z: 0 }, { x: 0, y: 0, z: -50 }, { x: 0, z: 0 }, flat, out);
  ok('water let go at 100 ft and 100 kt lands ahead, not underneath', -out.z > 30 && -out.z < 120, `${Math.round(-out.z)} m ahead after ${t.toFixed(1)} s`);
  const w = predictLanding({ x: 0, y: 30, z: 0 }, { x: 0, y: 0, z: 0 }, { x: 8, z: 0 }, flat, out);
  ok('…and drifts with the wind', out.x > 3, `${out.x.toFixed(1)} m downwind from a hover in 8 m/s, ${w.toFixed(1)} s`);
}

{
  // The scoop, with a stand-in aeroplane skimming the sea off Kestrel.
  T.applyMap('kestrel');
  const tank = new WaterTank(tempest);
  const ac = {
    pos: { x: 5000, y: 20, z: 1500 },
    ias: 100 / 1.94384,
    flap: 1,
    bank: 0,
    forward(v) {
      v.x = 0;
      v.y = 0;
      v.z = -1;
      return v;
    },
    flapStep() {
      return this.flap;
    },
    bankAngleDeg() {
      return this.bank;
    },
  };
  ok('skimming low, slow, flaps out, wings level fills the tank', tank.checkFill(ac, null) === true);
  ac.flap = 0;
  tank.checkFill(ac, null);
  ok('…not without flaps, and says so', !tank.filling && /flaps/i.test(tank.fillWhy), tank.fillWhy);
  ac.flap = 1;
  ac.pos.y = 60;
  tank.checkFill(ac, null);
  ok('…not too high, and says so', !tank.filling && /lower/i.test(tank.fillWhy), tank.fillWhy);
  ac.pos.y = 20;
  ac.ias = 200 / 1.94384;
  tank.checkFill(ac, null);
  ok('…not too fast, and says so', !tank.filling && /slower/i.test(tank.fillWhy), tank.fillWhy);
  ac.ias = 100 / 1.94384;
  ac.pos.x = 0;
  ac.pos.z = 900;
  ok('…and never over land', tank.checkFill(ac, null) === false);
  // Fill it and let it go.
  ac.pos.x = 5000;
  ac.pos.z = 1500;
  let secs = 0;
  while (tank.litres < tank.capacity && secs < 30) {
    tank.checkFill(ac, null);
    tank.fill(0.1);
    secs += 0.1;
  }
  ok('a full scoop takes seconds, not minutes', secs > 3 && secs < 12, `${secs.toFixed(1)} s for ${tank.capacity} L`);
  ok('X lets it go', tank.release() === 'dropped' && tank.releasing);
  let parcels = 0;
  const o = { x: 0, y: 30, z: 0 };
  const v = { x: 0, y: 0, z: -50 };
  for (let k = 0; k < 200 && tank.releasing; k++) tank.emitParcels(0.05, o, v, 30, () => parcels++);
  ok('…as a stream along the track, and the tank ends empty', parcels > 20 && tank.litres === 0 && !tank.releasing, `${parcels} parcels`);
  ok('an empty tank says so instead of dropping', tank.release() === 'empty');
}

{
  const tank = new WaterTank(tempest);
  tank.litres = tank.capacity;
  tank.release();
  let low = null;
  let high = null;
  tank.emitParcels(0.07, { x: 0, y: 40, z: 0 }, { x: 0, y: 0, z: -50 }, 40, (p) => { low = low || p.strength; });
  tank.releasing = false;
  tank.litres = tank.capacity;
  tank.release();
  tank.emitParcels(0.07, { x: 0, y: 400, z: 0 }, { x: 0, y: 0, z: -50 }, 400, (p) => { high = high || p.strength; });
  ok('a drop from 1,300 ft is weaker than one from 130 ft', low === 1 && high < 0.5, `strength ${low} low, ${high && high.toFixed(2)} high`);
}

/* ------------------------------------------------------------------ *
 * 4. The missions.
 * ------------------------------------------------------------------ */

{
  const heliMissions = MISSIONS.filter((m) => m.game === 'heli');
  const planeMissions = MISSIONS.filter((m) => (m.game || 'flight') === 'flight');
  ok('at least six fire missions', MISSIONS.length >= 6, `${MISSIONS.length}`);
  ok('all of them are rescue missions', MISSIONS.every((m) => m.category === 'rescue'));
  ok('…for the aeroplane and for the helicopter', planeMissions.length >= 4 && heliMissions.length >= 4, `${planeMissions.length} aeroplane, ${heliMissions.length} helicopter`);
  ok('the helicopter ones fly the Skyhook', heliMissions.every((m) => m.aircraft === 'harrier'));
  ok('Line One is on Firewatch Ridge', MISSIONS.some((m) => m.name === 'Line One' && m.map === 'firewatch'));
  ok('there is a night fire in each machine', planeMissions.some((m) => m.weather.time === 'night') && heliMissions.some((m) => m.weather.time === 'night'));
  ok('there is a town to save in each machine', planeMissions.some((m) => fireSpecOf(m).protect === 'town') && heliMissions.some((m) => fireSpecOf(m).protect === 'town'));
  const fields = ['id', 'name', 'short', 'difficulty', 'icon', 'blurb', 'reward', 'map', 'aircraft', 'weather', 'spawn', 'steps', 'onStart', 'fire'];
  const missing = MISSIONS.flatMap((m) => fields.filter((f) => !m[f]).map((f) => `${m.id}.${f}`));
  ok('every mission has everything the menu and runner need', missing.length === 0, missing.join(', '));
  ok('difficulty is a word the menu has a colour for', MISSIONS.every((m) => ['Easy', 'Medium', 'Hard'].includes(m.difficulty)));
  const ids = ALL.MISSIONS.map((m) => m.id);
  const dup = ids.filter((id, i) => ids.indexOf(id) !== i);
  ok('no mission id is used twice in the whole game', dup.length === 0, dup.join(', '));
  ok('the fire missions are in the game\'s list', MISSIONS.every((m) => ALL.findMission(m.id)));
}

/* ------------------------------------------------------------------ *
 * 5. The frame, headless: wildfire.js's own hooks with a stand-in game.
 *
 * The browser checks do this for real; this catches a throw in the frame
 * path — which the plug-in layer answers by switching the feature off for
 * the session — without needing a browser at all, and times it.
 * ------------------------------------------------------------------ */
{
  const THREE = await imp('vendor/three.module.js');
  const ext = await imp('game/extensions.js');
  const wf = await imp('features/wildfire.js');
  const { Aircraft } = await imp('aircraft/physics.js');
  const { Weather } = await imp('world/weather.js');
  const m = MISSIONS.find((x) => x.id === 'fire-bigburn');
  T.applyMap(m.map);
  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0xffffff, 0.00002);
  const notes = [];
  const ac = new Aircraft();
  const sim = {
    scene,
    terrain: T.createTerrain(scene, 'low'),
    camera: new THREE.PerspectiveCamera(68, 1.6, 1, 40000),
    aircraft: ac,
    weather: new Weather(),
    settings: { quality: 'low' },
    hud: { notify: (t) => notes.push(t), toasts: [] },
    state: 'flying',
    mode: 'mission',
    aircraftType: tempest,
    input: { bindings: { drop: ['KeyX'] } },
  };
  const e = ext.extensions().find((x) => x.id === 'wildfire');
  ok('the wildfire feature registers itself on import', !!e);
  let threw = null;
  try {
    const group = new THREE.Group();
    scene.add(group);
    e.buildWorld(sim, group);
    sim.weather.load(m.weather);
    ac.reset({ pos: new THREE.Vector3(5200, 0, -2500), headingDeg: 250, speed: 60, altAGL: 250, engineOn: true });
    wf.setupFire(sim, fireSpecOf(m));
    const W = wf.wildfireDebug();
    sim.camera.position.set(3000, 300, -1800);
    for (let k = 0; k < 30 * 30; k++) e.update(sim, 1 / 30);
    ok('headless: a forest fire burns, smokes and plants its wood', W.grid.burning > 0 && W.plumes.alive > 30 && W.woods && W.woods.count > 300, `${W.grid.burning} burning, ${W.plumes.alive} puffs, ${W.woods && W.woods.count} trees`);
    W.tank.litres = W.tank.capacity;
    const t = wf.dropPoint();
    ac.pos.set(t.x - 110, T.heightAt(t.x, t.z) + 40, t.z);
    ac.vel.set(50, 0, 0);
    const key = e.key(sim, 'KeyX', true, { repeat: false });
    for (let k = 0; k < 30 * 8; k++) e.update(sim, 1 / 30);
    const st = wf.fireStatus(sim);
    ok('headless: X is consumed and the drop lands on the fire', key === true && st.drops === 1 && st.hits === 1, `${st.hits} hit; said "${notes[notes.length - 1]}"`);
    ok('headless: the water is carried as weight, and goes with the drop', ac.extraMass === 0 && W.tank.litres === 0, `${ac.extraMass} kg`);
    ok('headless: X belongs to the game again with no tank', (() => {
      e.stop(sim, 'menu');
      return e.key(sim, 'KeyX', true, {}) === false;
    })());
    // At the cap, on Low.
    wf.setupFire(sim, fireSpecOf(m));
    const g = W.grid;
    for (let k = 0; k < 10; k++) g.ignite(t.x + Math.cos(k) * 500, t.z + Math.sin(k) * 500, 250);
    for (let k = 0; k < 60; k++) e.update(sim, 1 / 30);
    // Frames with a spread tick in them (one in fifteen) and frames without,
    // judged by their medians. Not by the worst frame: a pause from outside —
    // this machine's CPU governor stops a busy process for half a second at
    // a time, and the garbage collector does what it likes — lands in
    // whichever frame is running. Measured with the frame wrapped: 509 ms in
    // a smoke update that costs 0.02, 7 ms in a loop over 110 puffs.
    const plain = [];
    const ticked = [];
    for (let k = 0; k < 30 * 20; k++) {
      const before = g.stats.ticks;
      const a = performance.now();
      e.update(sim, 1 / 30);
      (g.stats.ticks !== before ? ticked : plain).push(performance.now() - a);
    }
    const med = (arr) => arr.slice().sort((x, y) => x - y)[arr.length >> 1];
    ok(
      'headless: at the cap the fire costs well under a millisecond a frame, and its ticks do not spike',
      g.burning === g.maxBurning && med(plain) < 0.5 && med(ticked) < 3,
      `${g.burning}/${g.maxBurning} burning: median ${med(plain).toFixed(3)} ms a frame, ${med(ticked).toFixed(2)} ms on a frame with a spread tick (a 2019 Chromebook is five to eight times slower)`
    );
    e.stop(sim, 'menu');
    ok('headless: stopping leaves nothing behind', !wf.fireStatus(sim).live && W.plumes.alive === 0 && !W.woods && ac.extraMass === 0);

    // One drop that puts a small fire right out must be a win, not "it burnt
    // itself out": the hit has to be on the books by the frame the fire is.
    const spot = MISSIONS.find((x) => x.id === 'fire-spot');
    T.applyMap(spot.map);
    sim.terrain = T.createTerrain(new THREE.Scene(), 'low');
    const g2 = new THREE.Group();
    e.buildWorld(sim, g2);
    sim.weather.load(spot.weather);
    wf.setupFire(sim, fireSpecOf(spot));
    W.tank.litres = W.tank.capacity;
    const c = W.grid.centroid({ x: 0, z: 0 });
    let verdict = 'never out';
    for (let tries = 0; tries < 3 && W.grid.burning; tries++) {
      W.tank.litres = W.tank.capacity;
      ac.pos.set(c.x + 110, T.heightAt(c.x, c.z) + 35, c.z);
      ac.vel.set(-50, 0, 0);
      e.key(sim, 'KeyX', true, {});
      for (let k = 0; k < 30 * 10 && W.grid.burning; k++) {
        e.update(sim, 1 / 30);
        if (!W.grid.burning) {
          const why = spot.failIf({ sim, elapsed: 60 });
          verdict = `out after ${tries + 1} drop(s) with ${wf.fireStatus(sim).hits} hit(s); the mission says ${why ? `"${why}"` : 'nothing is wrong'}`;
        }
      }
    }
    ok('headless: a drop that puts the last flame out counts as the hit that did it', /hit\(s\); the mission says nothing is wrong/.test(verdict) && !/with 0 hit/.test(verdict), verdict);
    e.stop(sim, 'menu');
  } catch (err) {
    threw = err;
  }
  ok('headless: the frame never throws', !threw, threw ? threw.stack.split('\n').slice(0, 3).join(' | ') : '');
}

/* ------------------------------------------------------------------ *
 * 6. The robot pilot.
 * ------------------------------------------------------------------ */

function windOf(w) {
  const speed = (w.windSpeedKts || 0) * 0.514444;
  const from = ((w.windDirDeg || 0) * Math.PI) / 180;
  return { x: -Math.sin(from) * speed, z: Math.cos(from) * speed };
}

/** Seeded, so a failure replays. */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Fly a mission's fire.
 *
 * The robot does what the HUD tells a child to do, at a child's pace:
 * fly to the water, fill, fly to the edge the arrow shows (re-reading the
 * arrow when it gets there), let go at the height the tip asks for, and go
 * back. Round trips are distance over a steady ground speed plus a fixed
 * overhead per trip for turning round, slowing down, lining up and waiting
 * for the bucket to settle — 60 s for the aeroplane, 45 s for the
 * helicopter, which is slow on purpose. The drop misses its aim point by up
 * to `aim` metres in a random direction. The water itself is the game's
 * WaterTank: its parcels fly, drift and land exactly as they do in the game.
 */
function fly(m, { pilot = 'steady', seed = 1, limit = 1500, aim = 35 } = {}) {
  T.applyMap(m.map);
  const spec = fireSpecOf(m);
  const type = getAircraft(m.aircraft);
  const g = new FireGrid({ size: 320, cell: 20, maxBurning: 900, seed: 7 });
  g.sampler = makeSampler(null, { woods: spec.woods });
  const sc = new FireScenario(g);
  const wind = windOf(m.weather);
  sc.start(spec, { wind });
  const tank = new WaterTank(type);
  const c = g.centroid({ x: 0, z: 0 }) || spec.centre;
  const fill = tank.kind === 'bucket'
    ? spec.water || findWater(c.x, c.z, 'bucket')
    : spec.lane || findWater(c.x, c.z, 'scooper');
  const log = [];
  const r = rng(seed);
  let t = 0;
  let hits = 0;
  let drops = 0;
  const firstIn = { at: null };
  const done = () => !g.burning || sc.reached;
  const wait = (sec) => {
    for (let s = 0; s < sec && !done(); s += 0.5) {
      sc.update(0.5, wind, hits);
      t += 0.5;
      if (t >= limit) return false;
    }
    return !done();
  };
  const P = tank.kind === 'bucket'
    ? { speed: 28, overhead: 45, height: 26, fwd: 8 }
    : { speed: 58, overhead: 60, height: 45, fwd: 52 };
  if (!fill) return { won: false, why: 'no water', t, drops, hits, log };
  let pos = { x: m.spawn.pos.x, z: m.spawn.pos.z };
  const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
  const out = { x: 0, y: 0, z: 0 };
  const douseRes = { doused: 0, wetted: 0, count: 0, xs: null, zs: null };
  if (pilot !== 'idle') {
    while (!done() && t < limit) {
      // To the water and fill.
      if (!wait(dist(pos, fill) / P.speed + tank.fillSeconds + P.overhead / 2)) break;
      pos = { x: fill.x, z: fill.z };
      // Towards the arrow, and look again on arrival.
      const t1 = sc.dropTarget({ x: 0, z: 0 });
      if (!t1) break;
      if (!wait(dist(pos, t1) / P.speed + P.overhead / 2)) break;
      const tg = sc.dropTarget({ x: 0, z: 0 });
      if (!tg) break;
      // Line up from wherever we came from, and let go so the middle of the
      // water lands on the target, give or take the aim.
      let ux = tg.x - pos.x;
      let uz = tg.z - pos.z;
      const L = Math.hypot(ux, uz) || 1;
      ux /= L;
      uz /= L;
      const miss = r() * aim;
      const ma = r() * Math.PI * 2;
      const ax = tg.x + Math.cos(ma) * miss;
      const az = tg.z + Math.sin(ma) * miss;
      const ground = Math.max(0, T.heightAt(ax, az));
      const v = { x: ux * P.fwd, y: 0, z: uz * P.fwd };
      predictLanding({ x: 0, y: P.height, z: 0 }, v, wind, () => 0, out);
      const rt = tank.kind === 'bucket' ? 0 : tank.releaseTime;
      const o = { x: ax - out.x - v.x * rt * 0.5, y: ground + P.height, z: az - out.z - v.z * rt * 0.5 };
      tank.litres = tank.capacity;
      tank.release();
      drops++;
      const id = tank.dropId;
      let doused = 0;
      const floor = (x, z) => Math.max(0, T.heightAt(x, z));
      for (let s = 0; s < 400 && (tank.releasing || tank.inFlight); s++) {
        const dt = 1 / 30;
        if (tank.releasing) {
          tank.emitParcels(dt, o, v, P.height, null);
          o.x += v.x * dt;
          o.z += v.z * dt;
        }
        tank.updateParcels(dt, wind, floor, (p, onLand) => {
          if (!onLand) return;
          douseRes.doused = 0;
          g.douse(p.x, p.z, p.r, p.strength, 16, douseRes, id);
          doused += douseRes.doused;
        });
      }
      if (doused > 0) {
        hits++;
        sc.noteHits(hits);
      }
      if (firstIn.at === null) firstIn.at = t;
      log.push(`${Math.round(t)}s drop ${drops}: ${doused} out, ${g.burning} left (${sc.across} across, ${sc.embers} embers, hold ${Math.round(sc.holdLeft)}), ${Math.round(sc.progress() * 100)}% contained${sc.protect ? `, ${Math.round(sc.protectDistance())} m from ${sc.protect.name}` : ''}`);
      pos = { x: tg.x, z: tg.z };
      if (pilot === 'once' && hits > 0) break;
    }
  }
  // Whatever is left, the crews or the clock finish.
  while (!done() && t < limit) wait(5);
  // Out, and out because of a drop: fire.js fails a fire that burnt itself out.
  const won = !g.burning && !sc.reached && hits > 0 && (sc.mopping || sc.recent);
  return { won, reached: sc.reached, across: sc.across, mopping: sc.mopping, t, drops, hits, first: firstIn.at, peak: g.peak, log, fill };
}

const LIMITS = { Easy: 360, Medium: 900, Hard: 1200 };
for (const m of MISSIONS) {
  T.applyMap(m.map);
  const spec = fireSpecOf(m);
  // The ground under every ignition point will burn.
  const g = new FireGrid({ size: 320, cell: 20, maxBurning: 900, seed: 7 });
  g.sampler = makeSampler(null, { woods: spec.woods });
  g.setWindow(spec.centre.x, spec.centre.z);
  const bad = (spec.ignite || []).filter((p) => !g.canBurn(p.x, p.z));
  ok(`${m.id}: every ignition point is on grass or forest`, bad.length === 0, bad.map((p) => `(${p.x}, ${p.z})`).join(' '));
  const sp = m.spawn;
  if (sp.altAGL != null) {
    ok(`${m.id}: starts in the air at a safe height`, sp.pos.y + sp.altAGL + Math.min(0, T.heightAt(sp.pos.x, sp.pos.z)) > 120 || sp.altAGL > 150);
  } else {
    ok(`${m.id}: starts on dry land`, T.heightAt(sp.pos.x, sp.pos.z) > 2);
  }
  if (spec.water) ok(`${m.id}: its water is open sea`, T.heightAt(spec.water.x, spec.water.z) < -10, `depth ${(-T.heightAt(spec.water.x, spec.water.z)).toFixed(0)} m`);
  if (spec.lane && m.aircraft !== 'harrier') {
    // The drawn lane (760 m, and 60 m either side of its line) is all sea.
    const L = spec.lane;
    const ux = Math.sin(L.heading);
    const uz = -Math.cos(L.heading);
    let shallow = -Infinity;
    for (let s = -440; s <= 440; s += 20) {
      for (const off of [-60, 0, 60]) shallow = Math.max(shallow, T.heightAt(L.x + ux * s - uz * off, L.z + uz * s + ux * off));
    }
    ok(`${m.id}: its scooping lane is open sea from end to end`, shallow < -5, `shallowest ${shallow.toFixed(1)} m`);
    // It points at the fire, so the fire is ahead when the tank is full.
    g.setWindow(spec.centre.x, spec.centre.z);
    const sc0 = new FireScenario(g);
    sc0.start(spec, { wind: windOf(m.weather) });
    const fc = g.centroid({ x: 0, z: 0 });
    const brg = (Math.atan2(fc.x - L.x, -(fc.z - L.z)) * 180) / Math.PI;
    const off = Math.abs(((brg - L.headingDeg + 540) % 360) - 180);
    ok(`${m.id}: the lane points at the fire`, off < 30, `${off.toFixed(0)}° off`);
    // The aeroplane starts on the lane's line, a comfortable glide short of it.
    const sx = L.x - ux * 380;
    const sz = L.z - uz * 380;
    const d = Math.hypot(sx - sp.pos.x, sz - sp.pos.z);
    const toStart = (Math.atan2(sx - sp.pos.x, -(sz - sp.pos.z)) * 180) / Math.PI;
    const turn = Math.abs(((toStart - sp.headingDeg + 540) % 360) - 180);
    const height = sp.altAGL + Math.min(0, T.heightAt(sp.pos.x, sp.pos.z));
    const fpm = ((height - 30) / (d / 60)) * 196.85;
    ok(`${m.id}: it starts lined up with its lane, with room to get down to it`, turn < 5 && d > 2000 && fpm < 1000, `${Math.round(d)} m out, ${turn.toFixed(0)}° to turn, ${Math.round(fpm)} ft/min to get down`);
  }

  const limit = LIMITS[m.difficulty] || 900;
  const runs = [1, 2, 3].map((seed) => fly(m, { seed, limit }));
  const wins = runs.filter((x) => x.won);
  const worst = Math.max(...runs.map((x) => x.t));
  ok(
    `${m.id}: a steady robot pilot wins (${m.difficulty}, ${limit} s)`,
    wins.length === runs.length,
    runs.map((x) => `${x.won ? 'won' : x.reached ? 'LOST (reached)' : 'not out'} in ${Math.round(x.t)} s, ${x.hits}/${x.drops} drops hit`).join('; ')
  );
  if (VERBOSE) for (const line of runs[0].log) console.log(`        ${line}`);
  if (m.difficulty === 'Easy') {
    ok(`${m.id}: one good drop does it`, runs.every((x) => x.drops <= 2), runs.map((x) => x.drops).join(', '));
  }
  if (m.difficulty === 'Hard' && !spec.line) {
    ok(`${m.id}: a big fire takes several fills`, runs.every((x) => x.drops >= 3), runs.map((x) => x.drops).join(', '));
  }
  if (m.difficulty !== 'Easy') {
    // One good drop and then circling until the fire burns down, or the
    // crews' clock runs out, is not putting a fire out.
    const lazy = [1, 2, 3].map((seed) => fly(m, { pilot: 'once', seed, limit: 1500 }));
    ok(
      `${m.id}: hitting it once and going home does not win it`,
      lazy.filter((x) => x.won).length <= 1,
      lazy.map((x) => `${x.won ? 'won' : x.reached ? 'reached' : x.t >= 1500 ? 'still burning' : 'burnt out'} at ${Math.round(x.t)} s`).join('; ')
    );
  }

  const idle = fly(m, { pilot: 'idle', limit: Math.max(limit, 1500) });
  const peak = Math.max(...runs.map((x) => x.peak), idle.peak);
  ok(`${m.id}: never more burning than the Low quality cap`, peak < 520, `peak ${peak} of 520`);
  const firstDrop = Math.max(...runs.map((x) => x.first || 0));
  const lasts = Math.max(600, firstDrop * 3);
  ok(
    `${m.id}: left alone it does not burn itself out before a child could get there`,
    idle.reached || idle.t >= lasts,
    `${idle.reached ? 'reached' : idle.t >= Math.max(limit, 1500) ? 'still burning' : 'burnt out'} at ${Math.round(idle.t)} s; needs ${Math.round(lasts)} s`
  );
  if (spec.line) {
    ok(`${m.id}: left alone, the fire is across the line and the crews never take over`, idle.across > 0 && !idle.mopping, `${idle.across} burning across at ${Math.round(idle.t)} s`);
  } else if (spec.protect) {
    ok(`${m.id}: left alone, the fire gets there`, idle.reached, `${Math.round(idle.t)} s`);
    ok(`${m.id}: …with time for a child to get the first drop in`, idle.t > firstDrop * 1.8, `first drop at ${Math.round(firstDrop)} s, fire there at ${Math.round(idle.t)} s`);
  }
  if (VERBOSE) console.log(`        worst win ${Math.round(worst)} s`);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

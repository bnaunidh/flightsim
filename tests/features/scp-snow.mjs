/**
 * Node checks for the snow lane: Nunatak Reach, the ice, the Site and the
 * Class-D transfer (src/world/maps.js 'nunatak', src/features/scp-site.js,
 * src/game/extra/scp.js, world/precip.js snow, aircraft/physics.js ice grip).
 *
 *   node tests/features/scp-snow.mjs
 *
 *   - the map is on the flight list (ten now), open to everybody, snow from
 *     the waterline up, snow in the air, the aurora kept subtle
 *   - the Site's yard and its strip are one level (50 m), the strip and the
 *     lake are ICE to the terrain, and ice gives the tyres a third of the
 *     grip: a Skylark-weight stop from 30 m/s takes about three times the
 *     distance it does on tarmac
 *   - the whole map builds at Low in the same order of cost as Northwatch
 *     (draw calls, triangles), and the Site adds under 70 draw calls
 *   - nothing the Site builds is enterable: every building, tower, the
 *     fence and the gate barrier are solid where they are drawn; the gate
 *     stand on the apron is open ground
 *   - the mission: on the flight list under 'events', borrows the snow map,
 *     flown in the C-17, starts on a stand at the base with room for its
 *     wing, nose in to the buildings, and runs start to finish against the
 *     real step checks with a fake aeroplane — boarding (the walk to the
 *     foot of the cargo ramp, waiting there while it is up, then up it into
 *     the hold), the pushback, the taxi to runway 09, take-off, crossing,
 *     the ice landing, the taxi to the T, the handover walk out of the hold
 *     and down the ramp — and its score lands in 0..100
 *   - the "braking action poor" note is said once when the wheels are on ice
 *   - the attribution: every SCP-based file carries the CC BY-SA credit, and
 *     the licence, the README and the credits screen say the content exists
 *   - the service worker precaches both new modules
 */

import { readFileSync } from 'node:fs';

/* ---- a page, as far as these modules need one ---- */
global.document = {
  createElement: () => ({
    getContext: () => new Proxy({}, { get: () => () => ({ addColorStop() {}, data: new Uint8ClampedArray(4), width: 10 }) }),
    width: 0,
    height: 0,
    style: {},
  }),
  body: { appendChild() {} },
  documentElement: { classList: { toggle() {}, contains() { return false; } } },
};
const store = new Map();
global.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};
global.window = global.window || { addEventListener() {}, requestAnimationFrame: null };
global.performance = global.performance || { now: () => Date.now() };

const root = new URL('../../', import.meta.url);
const SRC = new URL('src/', root).href;
const read = (p) => readFileSync(new URL(p, root), 'utf8');

const THREE = await import(SRC + 'vendor/three.module.js');
const T = await import(SRC + 'world/terrain.js');
const M = await import(SRC + 'world/maps.js');
const S = await import(SRC + 'world/scenery.js');
const F = await import(SRC + 'world/features.js');
const P = await import(SRC + 'world/pads.js');
const Precip = await import(SRC + 'world/precip.js');
const Phys = await import(SRC + 'aircraft/physics.js');
const Ext = await import(SRC + 'game/extensions.js');
const Site = await import(SRC + 'features/scp-site.js');
const Scp = await import(SRC + 'game/extra/scp.js');
const Missions = await import(SRC + 'game/missions.js');
const Layout = await import(SRC + 'world/airport-layout.js');
const Airport = await import(SRC + 'world/airport.js');

const results = [];
function ok(name, pass, detail = '') {
  results.push({ name, pass: !!pass, detail: String(detail) });
  console.log(`${pass ? 'ok  ' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
}

/* ================================================================== *
 * 1. The map
 * ================================================================== */

const map = M.getMap('nunatak');
ok('nunatak is a map, and the one asked for', map && map.id === 'nunatak' && map.name === 'Nunatak Reach');
const flight = M.mapsForGame('flight').map((m) => m.id);
ok('the flight game offers ten maps and the snow map is one of them', flight.length === 10 && flight.includes('nunatak'), flight.join(' '));
ok('the snow map is open to everybody (not behind the military passcode)', !map.military);
ok('snow from the waterline up: the snow line is under the sea', Array.isArray(map.palette.snow) && map.palette.snow[1] < 0, JSON.stringify(map.palette.snow));
ok('snow falls here (precip: snow) and the trees are the snow flora', map.precip === 'snow' && map.scenery.flora === 'snow');
ok('the northern lights, kept subtle (intensity ≤ 0.6)', map.features && map.features.aurora && map.features.aurora.intensity <= 0.6, JSON.stringify(map.features && map.features.aurora));
ok('the map has a base for the Class-D to be collected from', !!(map.scenery.base && map.scenery.base.shelters > 0));
ok('the map carries the Site block the feature builds from', !!(map.scp && map.scp.yard && map.scp.door && map.scp.gate && map.scp.strip));

/* ---- snow in the air ---- */
{
  const cloudy = { cond: { cloud: 0.62, rain: 0 } };
  const clear = { cond: { cloud: 0.16, rain: 0 } };
  const stormy = { cond: { cloud: 1, rain: 1 } };
  ok('a cloudy sky snows on the snow map, a clear one does not, a storm is a blizzard',
    Precip.snowIntensity(cloudy, map) > 0.1 && Precip.snowIntensity(clear, map) === 0 && Precip.snowIntensity(stormy, map) === 1,
    `${Precip.snowIntensity(cloudy, map).toFixed(2)} / ${Precip.snowIntensity(clear, map)} / ${Precip.snowIntensity(stormy, map)}`);
  ok('…and never on any other map', Precip.snowIntensity(stormy, M.getMap('kestrel')) === 0 && Precip.snowIntensity(cloudy, M.getMap('northwatch')) === 0);
}

/* ================================================================== *
 * 2. The ice
 * ================================================================== */

T.applyMap(map);
const yard = T.getFlat('site-yard');
const strip = T.getFlat('site-strip');
const lake = T.getFlat('frozen-lake');
ok('the Site\'s yard and its strip are level with each other (50 m)', yard && strip && yard.y === 50 && strip.y === 50, `yard ${yard && yard.y}, strip ${strip && strip.y}`);
ok('the strip is ice to the terrain, the yard is concrete', strip && strip.surface === 'ice' && yard && yard.surface === 'tarmac');
ok('the frozen lake is ice, sunk below the plain round it', lake && lake.surface === 'ice' && T.heightAt(lake.cx, lake.cz) === 45 && T.heightAt(lake.cx, lake.z0 - 300) > 47,
  lake ? `${T.heightAt(lake.cx, lake.cz)} m on the lake, ${T.heightAt(lake.cx, lake.z0 - 300).toFixed(1)} m beside it` : 'no lake');
ok('iceAt: true on the strip and the lake, false on the runway and the yard',
  T.iceAt(map.scp.strip.cx, map.scp.strip.cz) && T.iceAt(lake.cx, lake.cz) && !T.iceAt(0, 0) && !T.iceAt(map.scp.gate.x, map.scp.gate.z));
ok('the strip is level along its whole length', (() => {
  let worst = 0;
  for (let x = strip.x0; x <= strip.x1; x += 20) worst = Math.max(worst, Math.abs(T.heightAt(x, strip.cz) - 50));
  return worst < 0.05;
})());
ok('ice ends where the ice is drawn: not 40 m out on the snow beside the strip, not in the lake rectangle\'s corners, not up its banks',
  !T.iceAt(map.scp.strip.cx, strip.z1 + 40) && T.iceAt(map.scp.strip.cx, strip.z1 + 3)
  && !T.iceAt(lake.x0 + 20, lake.z0 + 20) && T.iceAt(lake.cx + 440, lake.cz) && !T.iceAt(lake.cx, lake.z1 + 60)
  && !T.isPaved(map.scp.strip.cx, strip.z1 + 40));
ok('the strip and the yard count as prepared surfaces (isPaved)', T.isPaved(map.scp.strip.cx, map.scp.strip.cz) && T.isPaved(map.scp.gate.x, map.scp.gate.z));

/* ---- grip ---- */
{
  const ice = Phys.surfaceGrip(true, true, 0);
  const dry = Phys.surfaceGrip(true, false, 0);
  const wet = Phys.surfaceGrip(true, false, 1);
  const grass = Phys.surfaceGrip(false, false, 0);
  ok('ice: under half the cornering grip and well under half the braking of tarmac',
    ice.muSide <= dry.muSide / 2 && ice.brake <= dry.brake * 0.4 && ice.kind === 'ice',
    `side ${ice.muSide} vs ${dry.muSide}, brake ${ice.brake} vs ${dry.brake}`);
  ok('a wet runway is still grippier than ice; grass brakes between the two', wet.muSide > ice.muSide * 1.4 && grass.brake > ice.brake && grass.brake < dry.brake);
  // Stopping distance from 30 m/s at the brake fraction, no aero drag: v^2 / (2 g mu).
  const stop = (g) => (30 * 30) / (2 * 9.81 * (g.brake + g.muRoll));
  ok('a stop from 30 m/s takes about three times the distance on ice', stop(ice) / stop(dry) > 2.2 && stop(ice) / stop(dry) < 4.5,
    `${stop(ice).toFixed(0)} m on ice, ${stop(dry).toFixed(0)} m on tarmac`);
  // The flight model reads the helper where the tyres are.
  const src = read('src/aircraft/physics.js');
  ok('the tyre contact code reads surfaceGrip() with iceAt()', /const ice = iceAt\(world\.x, world\.z\);[\s\S]{0,80}surfaceGrip\(paved, ice, weather\.cond\.rain\)/.test(src) && /N \* grip\.brake/.test(src));
}

/* ================================================================== *
 * 3. Building it at Low, next to Northwatch
 * ================================================================== */

function buildAll(id, quality) {
  const m = M.getMap(id);
  T.applyMap(m);
  T.clearObstacles(); T.clearPlatforms(); P.clearPads();
  Airport.refreshRunways();
  const scene = new THREE.Scene();
  const sim = { scene, settings: { quality }, weather: { isNight: false, time: 'day' }, state: 'menu' };
  const scenery = new S.Scenery(scene, quality);
  const features = new F.MapFeatures(scene, quality);
  const groups = Ext.extBuildWorld(sim, THREE);
  const ext = groups.find((g) => g.name === 'ext:scp-site');
  let draws = 0;
  let tris = 0;
  let extDraws = 0;
  const count = (o, into) => {
    if (!(o.isMesh || o.isPoints)) return;
    into.draws++;
    const g = o.geometry;
    const n = g.index ? g.index.count / 3 : g.attributes.position ? g.attributes.position.count / 3 : 0;
    into.tris += n * (o.isInstancedMesh ? o.count : 1);
  };
  const all = { draws: 0, tris: 0 };
  scene.traverse((o) => count(o, all));
  draws = all.draws; tris = all.tris;
  if (ext) {
    const e = { draws: 0, tris: 0 };
    ext.traverse((o) => count(o, e));
    extDraws = e.draws;
  }
  return { scenery, features, ext, draws, tris, extDraws, obstacles: T.OBSTACLES.slice(), sim };
}

const low = buildAll('nunatak', 'low');
const north = buildAll('northwatch', 'low');
ok('the snow map builds at Low without throwing, Site included', !!low.ext && low.ext.children.length > 10, `${low.ext ? low.ext.children.length : 0} objects in the Site group`);
ok('Low budget: within Northwatch\'s draw calls plus the Site\'s, and the Site is under 50 draw calls',
  low.draws <= north.draws + 50 && low.extDraws < 50,
  `nunatak ${low.draws} draws (${low.extDraws} the Site), northwatch ${north.draws}`);
ok('Low budget: triangles within 1.6x Northwatch at Low', low.tris <= north.tris * 1.6, `${(low.tris / 1e6).toFixed(2)}M vs ${(north.tris / 1e6).toFixed(2)}M`);
ok('the terrain mesh is within the usual budget (≤ 120k vertices)', map.chunks.reduce((n, c) => n + (c.segments + 1) ** 2, 0) <= 120000);
{
  const names = [];
  low.ext.traverse((o) => { if (o.name) names.push(o.name); });
  ok('the Site built its parts: fence, towers, the main block, the blast doors, signs, the ice strip and its markers, the lake, the de-icing truck, the van',
    ['scp-fence-posts', 'scp-fence', 'scp-tower-legs', 'scp-main-block', 'scp-blast-door', 'scp-signs', 'ice:site-strip', 'ice-markers:site-strip', 'ice:frozen-lake', 'deicing-truck', 'transfer-van'].every((n) => names.includes(n)),
    names.filter((n, i) => names.indexOf(n) === i).join(' '));
  const snowTrees = [];
  low.scenery.group.traverse((o) => { if (/^trees:snow-/.test(o.name)) snowTrees.push(o.name); });
  ok('the trees are snow-dusted (snow flora)', snowTrees.length > 0, snowTrees.join(' '));

  /* ---- the runways read as runways in a cold place (owner, 2026-10-30: a blank white slab) ---- */
  let strip = null;
  low.ext.traverse((o) => { if (o.name === 'ice:site-strip') strip = o; });
  ok('the ice strip is a marked, textured surface (compacted snow with black markings), not a plain pale sheet',
    !!strip && !!strip.material.map && strip.material.map.image && strip.material.map.image.width >= 256, strip ? `map ${!!strip.material.map}` : 'no strip');
  ok('the ice strip has edge lights and ploughed snow banks along both sides',
    names.some((n) => n.startsWith('ice-lights:site-strip')) && names.some((n) => n.startsWith('ice-banks:site-strip')), names.filter((n) => /^ice-/.test(n)).join(' '));
  {
    // buildAll() left Northwatch applied; the field questions are asked of each map in turn.
    const wasMap = T.MAP;
    T.applyMap('nunatak');
    Airport.refreshRunways();
    const nun = Airport.snowCoveredField();
    let banks = null;
    try {
      const ap = new Airport.Airport(new THREE.Scene());
      ap.group.traverse((o) => { if (o.name === 'snow banks') banks = o; });
    } catch (e) {
      banks = String(e && e.message);
    }
    T.applyMap('northwatch');
    Airport.refreshRunways();
    const nw = Airport.snowCoveredField();
    T.applyMap('kestrel');
    Airport.refreshRunways();
    const ke = Airport.snowCoveredField();
    T.applyMap(wasMap.id);
    Airport.refreshRunways();
    ok('Caribou Base is a snow-covered field (its snow line is below the sea); Northwatch and Kestrel are bare', nun === true && nw === false && ke === false, `nunatak ${nun}, northwatch ${nw}, kestrel ${ke}`);
    ok('Caribou Base\'s runway has the plough\'s snow banks along both edges', !!banks && typeof banks === 'object', banks && banks.name ? banks.name : String(banks || 'no snow banks mesh'));
  }
}

/* ---- not enterable ---- */
{
  // Rebuild the snow map so the obstacle list is its own.
  const b = buildAll('nunatak', 'low');
  const info = Site.siteInfo();
  const faults = [];
  for (const bl of info.buildings) {
    const y = info.doorY + Math.min(3, bl.h / 2);
    const probes = [[0, 0], [0.4, 0.4], [-0.4, -0.4], [0.4, -0.4], [-0.4, 0.4]];
    for (const [fx, fz] of probes) {
      if (!T.obstacleAt(bl.x + fx * bl.w, y, bl.z + fz * bl.d)) faults.push(`${bl.name} at ${fx},${fz}`);
    }
    // Up to the roof: the top floor is solid too.
    if (!T.obstacleAt(bl.x, info.doorY + bl.h - 0.5, bl.z)) faults.push(`${bl.name} under the roof`);
  }
  ok('every building of the Site is solid across all of what is drawn (no inside to get to)', faults.length === 0 && info.buildings.length >= 3, faults.join('; ') || `${info.buildings.length} buildings`);
  const doorIn = T.obstacleAt(map.scp.door.x, info.doorY + 3, map.scp.door.z - 2);
  const doorOut = T.obstacleAt(map.scp.door.x, info.doorY + 3, map.scp.door.z + 6);
  ok('the blast door is shut: solid just inside it, open air just outside it', !!doorIn && !doorOut);
  const towers = info.towers.filter((t) => T.obstacleAt(t.x, t.top - 2, t.z) && T.obstacleAt(t.x, info.doorY + 2, t.z)).length;
  ok('all four guard towers are solid, legs to roof', towers === 4 && info.towers.length === 4, `${towers} of ${info.towers.length}`);
  const Y = map.scp.yard;
  const fence = [[(Y.x0 + Y.x1) / 2, Y.z0], [Y.x1, (Y.z0 + Y.z1) / 2], [Y.x0, (Y.z0 + Y.z1) / 2], [Y.x1 - 40, Y.z1]]
    .filter(([x, z]) => T.obstacleAt(x, T.heightAt(x, z) + 1.5, z)).length;
  ok('the fence is solid on all four sides, and the gate barrier across the gap', fence === 4 && !!T.obstacleAt(map.scp.gate.x, info.doorY + 0.8, Y.z1), `${fence} sides`);
  ok('the gate stand on the apron is open ground (you can taxi to it)', !T.obstacleAt(map.scp.gate.x, info.doorY + 1, map.scp.gate.z) && !T.obstacleAt(map.scp.gate.x, info.doorY + 1, map.scp.gate.z + 20));
  ok('nothing of the Site stands on its own strip', !b.obstacles.some((o) => o.y1 > 50.5 && o.x1 >= strip.x0 && o.x0 <= strip.x1 && o.z1 >= strip.z0 - 5 && o.z0 <= strip.z1 + 5));
  ok('the de-icing truck and the van are parked by a stand at the base, on the airfield pad',
    (() => {
      const v = Site.groundVehicles();
      return v.deicer && v.van && T.padWeight(v.deicer.x, v.deicer.z) > 0.9 && T.padWeight(v.van.x, v.van.z) > 0.9 && !T.isOnAnyRunway(v.deicer.x, v.deicer.z, 10);
    })(), JSON.stringify(Site.groundVehicles()));
}

/* ================================================================== *
 * 4. The mission, start to finish
 * ================================================================== */

const def = Missions.findMission('classd-transfer');
ok('the Class-D transfer is on the flight missions list, under events, on the snow map, in the C-17 (the owner: "Class-D transfer -> C-17")',
  def && Missions.missionsFor('flight').includes(def) && def.category === 'events' && def.map === 'nunatak' && def.aircraft === 'c17' && !def.military);
ok('it has a briefing: a name, a blurb, what it teaches, a par time and eight steps in the order a departure from a stand goes — board, push back, taxi, take off',
  def && def.name && def.blurb.length > 80 && def.reward && def.parTime > 0
  && def.steps.map((s) => s.id).join(',') === 'board,pushback,taxi-out,depart,cross,land,gate,handover', def && def.steps.map((s) => s.id).join(','));
ok('every step tells the pilot what to do and gives a hint', def.steps.every((s) => s.text && s.hint));

{
  // The world as the runner has it: the snow map built, the Site up.
  const b = buildAll('nunatak', 'low');
  const lay = Layout.airportLayout();
  const spawn = def.spawn;
  const sp = spawn.pos;
  const tst = Site.transferStand();
  ok('the mission starts on a stand at the base, on the levelled airfield, nose in to the buildings (the stand\'s own heading)', !!tst && Math.hypot(sp.x - tst.x, sp.z - tst.z) < 1 && spawn.headingDeg === tst.headingDeg && Math.abs(T.heightAt(sp.x, sp.z) - T.AIRPORT.elev) < 0.3,
    `${sp.x.toFixed(0)},${sp.z.toFixed(0)} heading ${spawn.headingDeg}, stand ${tst && tst.number}`);
  // The C-17's wing (51.75 m) is wider than a stand (44 m): the one it starts on has empty stands either side of it.
  const clash = lay.stands.filter((q) => q !== tst && Layout.standTaken(q) && Math.hypot(q.x - tst.x, q.z - tst.z) < 26 + 4 + (q.maxSpan || 40) / 2);
  ok('…one whose neighbours\' aeroplanes are clear of the C-17\'s wing tips', !!tst && !Layout.standTaken(tst) && clash.length === 0, clash.map((q) => q.number).join(', ') || `stand ${tst && tst.number}`);

  // A fake aeroplane and a fake sim, enough for the checks and the feature: a C-17, with its cargo ramp (fleet/extra/c17.js userData.cargo).
  const ac = { pos: new THREE.Vector3(sp.x, T.AIRPORT.elev, sp.z), heading: spawn.headingDeg, groundSpeed: 0, onGround: true, groundTime: 5, airborneTime: 0, agl: 0, crashed: false };
  const said = [];
  let rampAmt = 0;
  const cargo = { amount: () => rampAmt, open() { rampAmt = 1; }, close() { rampAmt = 0; }, get isOpen() { return rampAmt > 0.97; } };
  const sim = { ...b.sim, aircraft: ac, aircraftType: { id: 'c17', cargoRamp: true }, model: { userData: { cargo } }, hud: { notify: (t) => said.push(t) }, notify: (t) => said.push(t), speak: (t) => said.push(`radio: ${t}`), audio: null, state: 'flying' };
  const ext = Ext.extensions().find((e) => e.id === 'scp-site');
  ext.install(sim);
  ext.startMode(sim, 'mission', { id: def.id });
  let elapsed = 0;
  const ctx = { sim, ac, data: {}, runner: { stepIndex: 0, elapsed: 0, stepElapsed: 0 }, get elapsed() { return elapsed; } };
  const run = (seconds, dt = 1 / 20) => {
    for (let t = 0; t < seconds; t += dt) {
      elapsed += dt;
      ext.update(sim, dt);
    }
  };
  const step = (id) => def.steps.find((s) => s.id === id);

  def.onStart(ctx);
  let st = Site.transferState();
  ok('onStart: six people step out of the van — two escort, four Class-D in orange', st && st.people.length === 6 && st.people.filter((p) => p.kind === 'classd').length === 4 && st.people.every((p) => p.p.name === `person:${p.kind}`),
    st && st.people.map((p) => p.kind).join(' '));
  const gv = Site.groundVehicles();
  const ramp0 = Site.rampOf(sim);
  ok('the van is parked off the C-17\'s left side, level with the foot of its ramp, and not in the way of the wing', !!gv.van && !!ramp0 && Math.hypot(gv.van.x - ramp0.foot.x, gv.van.z - ramp0.foot.z) < 40 && Math.hypot(gv.van.x - ac.pos.x, gv.van.z - ac.pos.z) > 26,
    gv.van ? `${Math.hypot(gv.van.x - ramp0.foot.x, gv.van.z - ramp0.foot.z).toFixed(0)} m from the ramp` : 'no van');
  ok('board: not done before anyone has reached the ramp', step('board').check(ctx) === false);
  const far = Site.transferState().people.map((p) => Math.hypot(p.x - ramp0.foot.x, p.z - ramp0.foot.z));
  run(8);
  const nearer = Site.transferState().people.map((p) => Math.hypot(p.x - ramp0.foot.x, p.z - ramp0.foot.z));
  ok('the walk: everybody is closer to the ramp after eight seconds, at a walking pace', nearer.every((d, i) => d < far[i] - 6 && d > far[i] - 16), `${far[0].toFixed(0)} → ${nearer[0].toFixed(0)} m`);
  // Nobody walks up to a moving aeroplane.
  ac.groundSpeed = 4;
  const before = Site.transferState().people.map((p) => p.x + p.z);
  run(2);
  ok('…and they stop while the aeroplane is rolling', Site.transferState().people.every((p, i) => Math.abs(p.x + p.z - before[i]) < 0.01));
  ac.groundSpeed = 0;
  // The ramp is still up: they walk to its foot and wait there.
  run(40);
  const waiting = Site.transferState();
  ok('with the ramp up they wait at its foot: nobody climbs it, nobody goes aboard', !!waiting && waiting.people.every((w) => !w.done && !w.climb && w.p.visible) && Math.hypot(waiting.people[0].x - ramp0.foot.x, waiting.people[0].z - ramp0.foot.z) < 1,
    waiting ? waiting.people.map((w) => Math.hypot(w.x - ramp0.foot.x, w.z - ramp0.foot.z).toFixed(1)).join(' ') : 'no walk');
  ok('…and the step is not done', step('board').check(ctx) === false);
  // Ramp down (6, or RAMP): up it they go.
  cargo.open();
  let boarded = false;
  // The route: nobody walks through the de-icing truck or the aeroplane but up its ramp, and
  // nobody goes aboard (vanishes) anywhere but inside the hold, at the floor's height.
  const h0 = (spawn.headingDeg || 0) * Math.PI / 180;
  const local = (x, z, cx, cz) => {
    const dx = x - cx;
    const dz = z - cz;
    // along: forward (sin h, -cos h); across: right (cos h, sin h)
    return { along: dx * Math.sin(h0) - dz * Math.cos(h0), across: dx * Math.cos(h0) + dz * Math.sin(h0) };
  };
  const clashes = [];
  const vanishedAt = [];
  let highest = 0;
  const seen = new Set();
  for (let i = 0; i < 1800 && !boarded; i++) {
    run(0.1);
    const T0 = Site.transferState();
    if (T0) {
      for (const w of T0.people) {
        const a = local(w.x, w.z, ac.pos.x, ac.pos.z);
        // In the fuselage (3.5 m either side of the centre line, nose to tail) other than on the ramp's line and in the hold.
        // Behind the hinge (12.5 m aft) is the ramp and the open door, nothing to walk into.
        const onRampLine = Math.abs(a.across) < 1.4 && a.along < -6;
        if (!w.done && Math.abs(a.across) < 3.5 && a.along > -12.5 && a.along < 22 && !onRampLine) clashes.push(`#${w.i} in the fuselage`);
        if (gv.deicer) {
          const t = local(w.x, w.z, gv.deicer.x, gv.deicer.z);
          if (Math.abs(t.across) < 1.5 && Math.abs(t.along) < 4) clashes.push(`#${w.i} in the de-icer`);
        }
        if (!w.done) highest = Math.max(highest, w.p.position.y - ramp0.ground);
        if (w.done && !seen.has(w.i)) { seen.add(w.i); vanishedAt.push({ d: Math.hypot(w.x - ramp0.inside.x, w.z - ramp0.inside.z), y: w.p.position.y - ramp0.ground }); }
      }
    }
    boarded = step('board').check(ctx);
  }
  ok('board: completes once all six have walked up the ramp, and they are gone aboard', boarded && ctx.data.boarded && !Site.transferState(), `${elapsed.toFixed(0)} s`);
  ok('…walking round the aeroplane and the de-icing truck, not through them, and up the ramp on its centre line', clashes.length === 0, clashes.slice(0, 4).join('; ') || `van at ${gv.van && gv.van.x.toFixed(0)},${gv.van && gv.van.z.toFixed(0)}`);
  ok('…each goes aboard INSIDE the hold, up on the cargo floor (no one vanishes at the foot of the ramp)', vanishedAt.length === 6 && vanishedAt.every((v) => v.d < 0.5 && Math.abs(v.y - ramp0.rise) < 0.05), vanishedAt.map((v) => `${v.d.toFixed(1)} m, ${v.y.toFixed(2)} up`).join(' · '));
  ok('…climbing the ramp to the floor\'s height (2.2 m) as they go', Math.abs(highest - ramp0.rise) < 0.05 && ramp0.rise > 2, `${highest.toFixed(2)} m`);
  ok('…the loadmaster raises the ramp behind them, with a word to the pilot', rampAmt === 0 && said.some((t) => /aboard/i.test(t) && /ramp/i.test(t)), said.slice(-2).join(' | '));

  // Push back: a finished push (airport-services' own count), or the aeroplane well off its stand.
  ctx.runner.stepIndex = 1;
  const AS = await import(SRC + 'features/airport-services.js');
  // Into the step however the boarding ended (the Dev panel's skip mid-walk): the tug's hold goes, and the walk.
  AS.setServicesHold('test hold');
  step('pushback').enter(ctx);
  ok('pushback: entering it lifts the tug\'s hold (a skipped boarding left every push refused)', AS.__airportServices.S.hold == null && !Site.transferState(), String(AS.__airportServices.S.hold));
  ok('pushback: not done on the stand', step('pushback').check(ctx) === false);
  AS.__airportServices.S.pushes = (AS.__airportServices.S.pushes || 0) + 1;
  ok('pushback: done once the tug has finished a push', step('pushback').check(ctx) === true);
  AS.__airportServices.S.pushes -= 1;
  ac.pos.set(tst.x + 30, T.AIRPORT.elev, tst.z + 60);
  ok('…or once the aeroplane is well clear of its stand on the ground, however it got there', step('pushback').check(ctx) === true);

  ctx.runner.stepIndex = 2;
  ok('taxi-out: not done on the apron', step('taxi-out').check(ctx) === false);
  // The arrow: onto the runway by the taxiway nearest the stand (A2 at Caribou), not the long way past the hangar.
  const entry = step('taxi-out').target(ctx);
  ok('taxi-out: the arrow points at the runway where the nearest taxiway meets it', T.isOnAnyRunway(entry.x, entry.z, 0) && Math.abs(entry.x - tst.x) < 200, `${entry.x.toFixed(0)},${entry.z.toFixed(0)} (stand at x ${tst.x.toFixed(0)})`);
  ac.pos.set(entry.x + 30, T.AIRPORT.elev, entry.z);
  ac.heading = 180;
  ok('taxi-out: on the runway but across it is not lined up', step('taxi-out').check(ctx) === false);
  ac.heading = 92;
  ok('taxi-out: done on runway 09, lined up facing east', step('taxi-out').check(ctx) === true);

  ctx.runner.stepIndex = 3;
  ok('depart: not done on the ground', step('depart').check(ctx) === false);
  ac.onGround = false; ac.airborneTime = 5; ac.agl = 80;
  ok('depart: done once airborne and climbing', step('depart').check(ctx) === true);

  ctx.runner.stepIndex = 4;
  ac.pos.set(1500, 400, -800); ac.agl = 350;
  ok('cross: not done half way', step('cross').check(ctx) === false);
  ac.pos.set(map.scp.strip.cx - 2000, 400, map.scp.strip.cz + 300); ac.agl = 340;
  ok('cross: done inside 2.6 km of the strip', step('cross').check(ctx) === true);
  ac.pos.set(map.scp.strip.cx - 1500, 80, map.scp.strip.cz); ac.agl = 30;
  ok('cross: done for a low arrival too (it asked for 400 ft and a low approach was stuck here for good)', step('cross').check(ctx) === true);

  ctx.runner.stepIndex = 5;
  const zone = Scp.stripZone();
  ok('the landing box is the strip plus the usual shoulders, at the strip\'s level', zone && zone.elev === 50 && zone.halfLength === map.scp.strip.halfLen + 60 && zone.halfWidth === map.scp.strip.halfWidth + 15);
  // Down on the grass beside the strip: never.
  ac.onGround = true; ac.agl = 0; ac.pos.set(map.scp.strip.cx, 50, map.scp.strip.cz + 120);
  ctx.data.lastTouchdown = { crashed: false, score: 70 };
  let landed = false;
  for (let i = 0; i < 4; i++) { elapsed += 0.1; landed = step('land').check(ctx, 0.1) || landed; }
  ok('land: down beside the strip does not count', landed === false);
  ac.pos.set(map.scp.strip.cx + 200, 50.6, map.scp.strip.cz);
  for (let i = 0; i < 4; i++) { elapsed += 0.1; landed = step('land').check(ctx, 0.1) || landed; }
  ok('land: a real touchdown inside the ice strip\'s box counts', landed === true);
  // Rolling on the ice: the feature says so, once.
  ac.groundSpeed = 25;
  said.length = 0;
  run(1);
  run(1);
  ok('"braking action poor" is said once when the wheels are on the ice', said.filter((t) => /braking action poor/i.test(t)).length === 1, said.join(' | '));

  ctx.runner.stepIndex = 6;
  // The roll ran out half way down the strip: that is where the stop is read.
  ac.groundSpeed = 1; ac.pos.set(map.scp.strip.cx + 300, 50, map.scp.strip.cz);
  def.tick(ctx, 0.05);
  ok('the stop on the ice is read once the landing is done and the aeroplane is slow', ctx.data.iceStop && Math.abs(ctx.data.iceStop.x - (map.scp.strip.cx + 300)) < 0.01);
  {
    // Scored whichever way the strip was landed on: past either end loses the same.
    const keep = ctx.data.iceStop;
    const sc = (x) => { ctx.data.iceStop = { x, z: map.scp.strip.cz }; return def.score(ctx); };
    const inside = sc(map.scp.strip.cx);
    const pastE = sc(map.scp.strip.cx + map.scp.strip.halfLen + 200);
    const pastW = sc(map.scp.strip.cx - map.scp.strip.halfLen - 200);
    ok('the ice score: a stop inside the strip beats an overrun, and an overrun is an overrun at either end', inside > pastE && pastE === pastW, `${inside} / ${pastE} / ${pastW}`);
    ctx.data.iceStop = keep;
  }
  ac.groundSpeed = 6;
  ok('gate: not done while rolling', step('gate').check(ctx) === false);
  ac.groundSpeed = 0; ac.groundTime = 4; ac.pos.set(map.scp.gate.x + 3, 50, map.scp.gate.z - 2); ac.heading = 0;
  ok('gate: done stopped on the T', step('gate').check(ctx) === true);

  ctx.runner.stepIndex = 7;
  const info2 = Site.siteInfo();
  // An aeroplane parked at the edge of the T's circle, off to the west: the
  // straight line from its door to the blast door would cross the fence.
  ac.pos.set(map.scp.gate.x - 22, 50, map.scp.gate.z + 8); ac.heading = 20;
  ok('handover: with the ramp up nobody gets out', step('handover').check(ctx) === false && !ctx.data.unloading && !Site.transferState());
  cargo.open();
  ok('handover: ramp down, the first ask starts the walk to the blast door', step('handover').check(ctx) === false && ctx.data.unloading && Site.transferState() && Site.transferState().label === 'handover');
  {
    // Out of the hold, one at a time, and down the ramp.
    const R1 = Site.rampOf(sim);
    const W = Site.transferState();
    const inHold = W.people.every((w) => !w.p.visible && Math.hypot(w.x - R1.inside.x, w.z - R1.inside.z) < 0.01);
    run(1.0);
    const out1 = W.people.filter((w) => w.p.visible).length;
    run(2.6);
    const onRamp = W.people.filter((w) => w.p.visible && w.p.position.y > R1.ground + 0.2).length;
    ok('…they come out of the hold one after another and walk down the ramp', inHold && out1 === 1 && onRamp >= 1, `${out1} out after 1 s, ${onRamp} on the ramp`);
  }
  let done = false;
  const arm = (() => { let a = null; b.ext.traverse((o) => { if (o.name === 'scp-gate-arm') a = o; }); return a; })();
  let armUp = 0;
  const fenceHits = [];
  for (let i = 0; i < 1200 && !done; i++) {
    run(0.1);
    if (arm) armUp = Math.max(armUp, arm.rotation.z);
    const T1 = Site.transferState();
    if (T1) for (const w of T1.people) if (T.obstacleAt(w.x, info2.doorY + 2.5, w.z)) fenceHits.push(`#${w.i} at ${w.x.toFixed(1)},${w.z.toFixed(1)}`);
    done = step('handover').check(ctx);
  }
  ok('handover: they walk in through the gate, never through the fence or a building', fenceHits.length === 0, fenceHits.slice(0, 3).join('; '));
  ok('…and the barrier arm lifts for them', !!arm && armUp > 1.2, arm ? armUp.toFixed(2) : 'no arm');
  run(4);
  ok('…and comes down again once they are through', !!arm && arm.rotation.z < 0.01, arm ? arm.rotation.z.toFixed(2) : 'no arm');
  const T2 = Site.transferState();
  ok('handover: done once all six stand at the blast door — still visible, still outside', done && T2 && T2.people.every((p) => p.p.visible && Math.hypot(p.x - map.scp.door.x, p.z - (map.scp.door.z + 4)) < 14),
    T2 ? T2.people.map((p) => Math.hypot(p.x - map.scp.door.x, p.z - map.scp.door.z).toFixed(0)).join(' ') : 'no walk');
  ok('…and nobody is inside the building', T2 && T2.people.every((p) => !T.obstacleAt(p.x, 51, p.z)));
  def.onComplete(ctx);
  ok('onComplete: the Site releases you on the radio', said.some((t) => /radio:.*Transfer received/.test(t)));
  const score = def.score(ctx);
  ok('the score is a number in 0..100', Number.isFinite(score) && score >= 0 && score <= 100, `${score}`);
  ext.stop(sim, 'menu');
  ok('stopping the flight takes the people away', !Site.transferState());
}

/* ================================================================== *
 * 5. Attribution, licence, offline cache
 * ================================================================== */

// The credit line, allowing for a comment's line break (" * ") inside it.
const CREDIT = /SCP Foundation content by the SCP Wiki[\s*]+community, CC BY-SA 3\.0,?[\s*]+scpwiki\.com/;
for (const f of ['src/features/scp-site.js', 'src/game/extra/scp.js']) {
  const s = read(f);
  ok(`${f}: carries the CC BY-SA 3.0 credit in its header`, CREDIT.test(s.slice(0, 1200)));
}
ok('maps.js: the snow map\'s entry carries the credit', CREDIT.test(read('src/world/maps.js')));
ok('person.js: the Class-D outfit carries the credit', CREDIT.test(read('src/features/staff/person.js')));
ok('LICENSE: says the SCP content is in the game now, and what it is', /Site-91 North/.test(read('LICENSE')) && !/none in the game yet/.test(read('LICENSE')));
ok('README and the credits screen say so too', /the Site on Nunatak Reach/.test(read('README.md')) && /the Site on Nunatak Reach/.test(read('src/ui/credits.js')));
ok('the Site feature is flash-safe: the searchlights sweep at 0.18 rad/s, the lamp pulses under the beacon cap', /Math\.sin\(S\.t \* 0\.18/.test(read('src/features/scp-site.js')) && /CAPS\.strobe/.test(read('src/features/scp-site.js')));
ok('the siren is behind the audio switch (available, not muted, environment bus)', /a\.mixer\.muted \|\| !a\.mixer\.busEnabled\('environment'\)/.test(read('src/features/scp-site.js')));
{
  const sw = read('sw.js');
  ok('sw.js precaches both new modules', sw.includes("'src/features/scp-site.js'") && sw.includes("'src/game/extra/scp.js'"));
}

const fails = results.filter((r) => !r.pass);
console.log(`\nscp-snow: ${results.length - fails.length}/${results.length} passed`);
process.exit(fails.length ? 1 : 0);

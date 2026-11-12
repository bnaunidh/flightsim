/**
 * Node checks for the town's emergency services (src/features/emergency-scene/dispatch.js,
 * the pure half of ./city.js):
 *
 *   /opt/homebrew/bin/node tests/features/city-emergency.mjs
 *
 *   1. WHO ANSWERS: the nearest town (by its edge); on or beside a runway
 *      nobody of ours (the airfield's case, unchanged); out of a town's reach
 *      on land, a helicopter; on the water by a town, the harbour boat and an
 *      ambulance to the quay; a ditching far out keeps its own rescue.
 *   2. THE STATIONS: beside a street end inside the town, the same ones for
 *      every incident, fire and police apart; a village's police share.
 *   3. THE ROUTES: along the streets and roads to the metre, off them only
 *      for the last stretch, never through the aeroplane; with no way over
 *      the ground they stop on the street, one behind the other.
 *   4. THE TIMES: police first, everybody inside ETA_MAX, nobody faster than
 *      a fire engine drives, nobody arriving before they set off.
 *   5. THE DETAIL LEVELS: three vehicles and nobody on foot on Low.
 *   6. THE REAL MAPS: Kestrel's town with its own streets and ground, and a
 *      World Map town with its street plan: a plan each, parked on dry land.
 *   7. THE FIRST LOAD: city.js and dispatch.js are not in main.js's static
 *      graph; emergency-scene.js fetches them only for an aeroplane in trouble.
 *
 * Exits 1 if anything fails.
 */
import { readFileSync } from 'node:fs';

globalThis.document = globalThis.document || {
  createElement: () => ({
    getContext: () => new Proxy({}, { get: () => () => ({ addColorStop() {}, data: new Uint8ClampedArray(4) }) }),
    width: 0, height: 0, style: {},
  }),
  body: { appendChild() {} },
  head: { appendChild() {} },
};
globalThis.window = globalThis.window || { addEventListener() {}, devicePixelRatio: 1 };

const src = new URL('../../src/', import.meta.url).href;
const D = await import(src + 'features/emergency-scene/dispatch.js');

let passed = 0;
let failed = 0;
function ok(name, pass, detail = '') {
  if (pass) passed++;
  else failed++;
  console.log(`${pass ? 'PASS' : 'FAIL'} ${name}${detail !== '' ? ` -- ${detail}` : ''}`);
}

/* ---- a town of our own: a 5 x 5 grid 100 m apart, a road out east, and a second town 5 km off ---- */
const polys = [];
for (let i = -2; i <= 2; i++) {
  polys.push({ pts: [[-200, i * 100], [200, i * 100]], kind: 'street' });
  polys.push({ pts: [[i * 100, -200], [i * 100, 200]], kind: 'street' });
}
polys.push({ pts: [[200, 0], [1500, 0]], kind: 'road' });
const polysB = [{ pts: [[4800, -150], [5200, -150]], kind: 'street' }, { pts: [[5000, -300], [5000, 300]], kind: 'street' }, { pts: [[1500, 0], [5000, 0]], kind: 'road' }];
const towns = [{ name: 'Alder', x: 0, z: 0, r: 300 }, { name: 'Birch', x: 5000, z: 0, r: 300 }];
const runways = [{ cx: 0, cz: 3000, length: 1200, hdg: 90, width: 30 }];
const base = { towns, runways, polylines: (t) => (t.name === 'Alder' ? polys : polysB), tier: 'high', span: 11 };
const plan = (incident, extra = {}) => D.planResponse({ ...base, incident, ...extra });

/* ---- 1 ---- */
{
  const a = plan({ x: 650, z: 120, kind: 'crash' });
  ok('a crash in a field by Alder: Alder answers, by road', a.case === 'town' && a.town.name === 'Alder', `${a.case} ${a.town && a.town.name}`);
  ok('...from Alder\'s own stations', a.units.every((u) => Math.hypot(u.from.x, u.from.z) < 300 * 1.2), a.units.map((u) => `${u.kind}:${Math.round(u.from.x)},${Math.round(u.from.z)}`).join(' '));
  const b = plan({ x: 4500, z: 100, kind: 'crash' });
  ok('a crash nearer Birch: Birch answers', b.case === 'town' && b.town.name === 'Birch' && b.units.every((u) => Math.hypot(u.from.x - 5000, u.from.z) < 400), `${b.case} ${b.town && b.town.name}`);
  const n = D.nearestTown([{ name: 'City', x: 0, z: 0, r: 2000 }, { name: 'Hamlet', x: 3000, z: 0, r: 100 }], 2300, 0);
  ok('the nearest town is the one whose EDGE is nearest (a city next door beats a hamlet\'s middle)', n.town.name === 'City', `${n.town.name} ${n.edge}`);
  const r1 = plan({ x: 100, z: 3000, kind: 'crash' });
  const r2 = plan({ x: 0, z: 3250, kind: 'forced' });
  const r3 = plan({ x: 900, z: 3010, kind: 'crash' });
  ok('on a runway, beside it, and off its end: the airfield\'s case, nothing of ours', r1.case === 'airport' && r2.case === 'airport' && r3.case === 'airport' && !r1.units, `${r1.case} ${r2.case} ${r3.case}`);
  ok('nearRunway: 320 m beside the strip is the airfield, 500 m is not', D.nearRunway(runways, 0, 3300) && !D.nearRunway(runways, 0, 3520));
  const h = plan({ x: 2400, z: 1600, kind: 'crash' });
  ok('in the hills, out of any town\'s reach: a helicopter from the nearest town', h.case === 'remote' && h.units.length === 0 && h.heli && h.town.name === 'Alder', h.case);
  ok('...there within ETA_MAX.heli, not before it sets off', h.heli.eta <= D.ETA_MAX.heli + 1e-6 && h.heli.eta > h.heli.depart, `${h.heli.eta.toFixed(1)} s`);
  const none = D.planResponse({ ...base, towns: [], incident: { x: 0, z: 0, kind: 'forced' } });
  ok('no town on the map at all: still a helicopter', none.case === 'remote' && !!none.heli);
  const noRoad = D.planResponse({ ...base, polylines: [], incident: { x: 100, z: 100, kind: 'crash' } });
  ok('a town with no streets at all: a helicopter', noRoad.case === 'remote');
  // The water.
  const sea = { harbour: () => [0, -420], seaRoute: (a, b) => [a, [400, -600], b] };
  const w = plan({ x: 900, z: -800, kind: 'crash', water: true }, sea);
  ok('in the water by Alder: the harbour boat', w.case === 'water' && !!w.boat && w.boat.pts.length === 3, w.case);
  const end = w.boat.pts[w.boat.pts.length - 1];
  ok('...which stops alongside, not on top (20-40 m short)', Math.hypot(end[0] - 900, end[1] + 800) > 20 && Math.hypot(end[0] - 900, end[1] + 800) < 40, `${Math.hypot(end[0] - 900, end[1] + 800).toFixed(0)} m`);
  ok('...inside ETA_MAX.boat', w.boat.eta <= D.ETA_MAX.boat + 1e-6 && w.boat.eta > 5, `${w.boat.eta.toFixed(1)} s`);
  const amb = w.units.find((u) => u.kind === 'ambulance');
  ok('...and an ambulance drives to the quay to meet it', !!amb && amb.quay && Math.hypot(amb.park.x, amb.park.z + 420) < 260 && D.offNetwork(amb.pts, polys) < 1, amb ? `${Math.round(amb.park.x)},${Math.round(amb.park.z)}` : 'none');
  const wl = plan({ x: 900, z: -800, kind: 'crash', water: true }, { ...sea, tier: 'low' });
  ok('...on Low the boat alone', wl.case === 'water' && wl.units.length === 0);
  const far = plan({ x: 2500, z: -9000, kind: 'ditch', water: true }, sea);
  ok('a ditching far from any town keeps its own rescue (features/ditching.js): nothing of ours', far.case === 'none', far.case);
  const farCrash = plan({ x: 2500, z: -9000, kind: 'crash', water: true }, sea);
  ok('a crash far out to sea: a helicopter', farCrash.case === 'remote');
  const noSea = plan({ x: 900, z: -800, kind: 'crash', water: true }, { harbour: () => null });
  ok('a town with no water to launch from: a helicopter', noSea.case === 'remote');
}

/* ---- 2 ---- */
{
  const a = plan({ x: 650, z: 120, kind: 'crash' });
  const b = plan({ x: -500, z: -300, kind: 'forced' });
  const same = (p, q) => Math.hypot(p.x - q.x, p.z - q.z) < 0.01;
  ok('the stations are the town\'s, the same for every incident', same(a.stations.fire, b.stations.fire) && same(a.stations.police, b.stations.police));
  ok('fire and police stand apart (120 m or more)', Math.hypot(a.stations.fire.x - a.stations.police.x, a.stations.fire.z - a.stations.police.z) >= 120);
  for (const s of [a.stations.fire, a.stations.police]) {
    const d = Math.hypot(s.x, s.z);
    ok(`the ${s.kind} station is inside the town, beside a street (set back 9-25 m)`, d < 300 * 1.2 && D.offNetwork([[s.x, s.z]], polys) > 8 && D.offNetwork([[s.x, s.z]], polys) < 26 && D.offNetwork([s.door], polys) < 0.5, `${Math.round(s.x)},${Math.round(s.z)}`);
    ok(`...with its doors to the street`, Math.abs(((D.bearing(s.x, s.z, s.door[0], s.door[1]) - s.heading + 540) % 360) - 180) < 1);
  }
  const g = D.buildGraph(polys);
  const village = D.stationsFor({ name: 'Wick', x: 0, z: 0, r: 200 }, g, polys);
  ok('a village\'s police share the fire station', village.police.shared === true && same(village.police, village.fire));
  const full = D.stationsFor({ name: 'Alder', x: 0, z: 0, r: 300 }, g, polys, () => false);
  ok('no room for a building: the vehicles come from the street end, and nothing is built', full.fire.built === false && D.offNetwork([[full.fire.x, full.fire.z]], polys) < 0.5);
  const picky = D.stationsFor({ name: 'Alder', x: 0, z: 0, r: 300 }, g, polys, (x, z) => x < 0);
  ok('a station is only put on ground that passes', picky.fire.x < 0 && picky.fire.built);
}

/* ---- 3 ---- */
{
  const inc = { x: 650, z: 120, kind: 'crash' };
  const a = plan(inc);
  let worstRoad = 0;
  let worstOff = 0;
  let nearest = Infinity;
  for (const u of a.units) {
    worstRoad = Math.max(worstRoad, D.offNetwork(u.pts, polys, 0, u.roadEnd));
    worstOff = Math.max(worstOff, D.pathLength(u.pts.slice(u.roadEnd - 1)));
    for (let i = 1; i < u.pts.length; i++) nearest = Math.min(nearest, D.segDist(inc.x, inc.z, u.pts[i - 1][0], u.pts[i - 1][1], u.pts[i][0], u.pts[i][1]));
  }
  ok('every unit drives the streets and the road, to the metre', worstRoad < 1, `worst ${worstRoad.toFixed(2)} m off them`);
  ok('...and leaves them only for the last stretch (under OFFROAD_MAX)', worstOff > 20 && worstOff <= D.OFFROAD_MAX * 1.6, `${worstOff.toFixed(0)} m`);
  ok('nobody drives through the aeroplane', nearest >= a.keep - 0.5, `nearest pass ${nearest.toFixed(1)} m, keep ${a.keep.toFixed(1)}`);
  const spread = a.units.map((u) => u.park);
  let close = Infinity;
  for (let i = 0; i < spread.length; i++) for (let j = i + 1; j < spread.length; j++) close = Math.min(close, Math.hypot(spread[i].x - spread[j].x, spread[i].z - spread[j].z));
  ok('nobody parks on anybody else (8 m or more apart)', close >= 8, `${close.toFixed(1)} m`);
  ok('the engines stand closest, facing the aeroplane', a.units.filter((u) => u.kind === 'fire').every((u) => Math.hypot(u.park.x - inc.x, u.park.z - inc.z) < a.clearR + 30 && Math.abs(((D.bearing(u.park.x, u.park.z, inc.x, inc.z) - u.heading + 540) % 360) - 180) < 1));
  ok('the ambulance backs up to it', a.units.filter((u) => u.kind === 'ambulance').every((u) => Math.abs(((D.bearing(inc.x, inc.z, u.park.x, u.park.z) - u.heading + 540) % 360) - 180) < 1));
  // The route is the short way: the road east, not a tour of the town.
  const fire = a.units.find((u) => u.kind === 'fire');
  const crow = Math.hypot(fire.from.door[0] - fire.park.x, fire.from.door[1] - fire.park.z);
  ok('the route is the short way round (under 1.6 times the straight line)', fire.len < crow * 1.6, `${fire.len.toFixed(0)} m by road, ${crow.toFixed(0)} m straight`);

  // On a street: the street under the aeroplane is shut, and the police close it either side.
  const st = plan({ x: 40, z: 100, kind: 'forced' });
  let through = Infinity;
  for (const u of st.units) for (let i = 1; i < u.pts.length; i++) through = Math.min(through, D.segDist(40, 100, u.pts[i - 1][0], u.pts[i - 1][1], u.pts[i][0], u.pts[i][1]));
  ok('down in a street: still nobody drives through it', st.case === 'town' && through >= st.keep - 0.5, `nearest pass ${through.toFixed(1)} m`);
  ok('...and the police close the road beside it', st.blocks.length >= 1 && st.units.filter((u) => u.block).every((u) => u.kind === 'police' && D.offNetwork([[u.park.x, u.park.z]], polys) < 1), `${st.blocks.length} roadblocks`);
  const fireRoutes = st.units.filter((u) => u.kind === 'fire').map((u) => u.pts);
  ok('...never across the engines\' way in', st.blocks.every((b) => fireRoutes.every((pts) => pts.every((p, i) => !i || D.segDist(b.x, b.z, pts[i - 1][0], pts[i - 1][1], p[0], p[1]) >= 20))));
  ok('a forced landing (nothing burning) gets one engine and one ambulance', st.units.filter((u) => u.kind === 'fire').length === 1 && st.units.filter((u) => u.kind === 'ambulance').length === 1);

  // No way over the ground (walls, a ditch): everybody stops on the street.
  const walled = plan(inc, { clear: () => false });
  ok('no way across the ground: every unit stops on the street', walled.case === 'town' && walled.units.every((u) => u.onStreet && D.offNetwork([[u.park.x, u.park.z]], polys) < 1));
  const q = walled.units.filter((u) => !u.block).map((u) => u.park);
  let gap = Infinity;
  for (let i = 0; i < q.length; i++) for (let j = i + 1; j < q.length; j++) gap = Math.min(gap, Math.hypot(q[i].x - q[j].x, q[i].z - q[j].z));
  ok('...one behind the other (9 m or more), not in a heap', gap >= 9, `${gap.toFixed(1)} m`);
  const noGround = plan(inc, { ok: () => false });
  ok('nowhere to stand by the aeroplane: on the street too, and still a plan', noGround.case === 'town' && noGround.units.filter((u) => u.kind !== 'police' || !u.block).every((u) => u.onStreet));

  // The graph itself.
  const g = D.buildGraph(polys);
  const Dj = D.distancesFrom(g, D.nearestNode(g, -200, -200));
  const far = D.nearestNode(g, 1500, 0);
  ok('the graph joins crossing streets: corner to the far end of the road is the Manhattan distance', Math.abs(Dj.dist[far] - (400 + 200 + 1300)) < 40, `${Dj.dist[far].toFixed(0)} m`);
  const apart = D.buildGraph([{ pts: [[0, 0], [100, 0]] }, { pts: [[0, 40], [100, 40]] }]);
  ok('...and does not join streets that only run side by side', D.distancesFrom(apart, 0).dist[D.nearestNode(apart, 100, 40)] === Infinity);
  const boxed = D.buildGraph(polys, { box: { x: 0, z: 0, r: 400 } });
  ok('a box keeps only what is near (a continent of highways costs nothing)', boxed.n < g.n && boxed.xs.every((x, i) => Math.hypot(x, boxed.zs[i]) <= 400));
}

/* ---- 4 ---- */
{
  for (const inc of [{ x: 650, z: 120, kind: 'crash' }, { x: 40, z: 100, kind: 'crash' }, { x: 1000, z: -300, kind: 'crash' }]) {
    const a = plan(inc);
    const first = a.units.slice().sort((p, q) => p.eta - q.eta)[0];
    ok(`(${inc.x}, ${inc.z}) the police are there first`, first.kind === 'police', `${first.kind} at ${first.eta.toFixed(1)} s`);
    ok('...everybody inside ETA_MAX for their kind', a.units.every((u) => u.eta <= D.ETA_MAX[u.kind] + u.idx * 3 + 1e-6), a.units.map((u) => `${u.kind}${u.idx}:${u.eta.toFixed(0)}`).join(' '));
    ok('...nobody there before they set off, nobody starting past the end', a.units.every((u) => u.eta > u.depart && u.startS >= 0 && u.startS < u.len && u.depart >= 0));
    // Top speed is the steady part of progress(): 8/7 of the average.
    const top = Math.max(...a.units.map((u) => (((u.len - u.startS) / (u.eta - u.depart)) * 8) / 7));
    ok('...nobody faster than 95 km/h, and the fire engines under 75', top * 3.6 <= 95 && a.units.filter((u) => u.kind === 'fire').every((u) => (((u.len - u.startS) / (u.eta - u.depart)) * 8) / 7 * 3.6 <= 75), `top ${(top * 3.6).toFixed(0)} km/h`);
    ok('...a first unit inside half a minute, the last inside 45 s', a.first <= 30 && a.last <= 45, `${a.first.toFixed(0)} s to ${a.last.toFixed(0)} s`);
  }
  const near = plan({ x: 150, z: -150, kind: 'crash' });
  const f = near.units.find((u) => u.kind === 'fire');
  ok('next door to the station: from the station itself, after the turnout', f.startS === 0 && f.depart >= D.TURNOUT.fire && f.eta < 25, `${f.depart}s + ${f.len.toFixed(0)} m = ${f.eta.toFixed(1)} s`);
  // progress(): the shape of a drive.
  let mono = true;
  let top = 0;
  for (let k = 0; k < 1; k += 0.001) {
    const v = (D.progress(k + 0.001) - D.progress(k)) / 0.001;
    if (v < -1e-9) mono = false;
    top = Math.max(top, v);
  }
  ok('a drive starts at 0, ends at 1, never goes backwards, and stops gently', D.progress(0) === 0 && D.progress(1) === 1 && mono && (D.progress(1) - D.progress(0.999)) / 0.001 < 0.01 && Math.abs(top - 8 / 7) < 0.01, `top ${top.toFixed(3)} of average`);
  const pts = [[0, 0], [100, 0], [100, 50]];
  const cum = D.cumulative(pts);
  const o = D.alongPath(pts, cum, 125, { x: 0, z: 0, heading: 0, i: 0 });
  ok('alongPath: 125 m along an L is 25 m up its second leg, heading south', Math.abs(o.x - 100) < 1e-6 && Math.abs(o.z - 25) < 1e-6 && Math.abs(o.heading - 180) < 1e-6, `${o.x},${o.z} ${o.heading}`);
}

/* ---- 5 ---- */
{
  const inc = { x: 650, z: 120, kind: 'crash' };
  const count = (p, k) => p.units.filter((u) => u.kind === k).length;
  const low = plan(inc, { tier: 'low' });
  const med = plan(inc, { tier: 'medium' });
  const high = plan(inc, { tier: 'high' });
  const ultra = plan(inc, { tier: 'ultra' });
  ok('Low: one engine, one ambulance, one police car and nobody on foot', low.units.length === 3 && count(low, 'fire') === 1 && count(low, 'ambulance') === 1 && count(low, 'police') === 1 && low.people === 0, `${low.units.length} vehicles, ${low.people} people`);
  ok('more of everything as the detail goes up, never more than seven vehicles', med.units.length >= low.units.length && high.units.length > med.units.length && ultra.units.length >= high.units.length && ultra.units.length <= 7 && ultra.people <= 9, `${low.units.length}/${med.units.length}/${high.units.length}/${ultra.units.length}`);
  const sh = D.crewShare(high.people);
  ok('the crews on foot: police, firefighters and two paramedics, adding up', sh.police + sh.firefighter + sh.paramedic === high.people && sh.paramedic === 2 && D.crewShare(0).police === 0, JSON.stringify(sh));
  const t0 = performance.now();
  for (let i = 0; i < 20; i++) plan({ x: 650 + i, z: 120, kind: 'crash' });
  const ms = (performance.now() - t0) / 20;
  ok('a plan costs a few milliseconds, once', ms < 12, `${ms.toFixed(2)} ms`);
}

/* ---- 6: the real maps ---- */
{
  const TR = await import(src + 'world/terrain.js');
  const SC = await import(src + 'world/scenery.js');
  const AP = await import(src + 'world/airport.js');
  TR.applyMap('kestrel');
  AP.refreshRunways();
  const T = TR.MAP.scenery.town;
  const planT = SC.planTown(T, 1);
  const kp = (planT.streets || []).filter((s) => s.pts && s.pts.length > 1).map((s) => ({ pts: s.pts, kind: 'street' }));
  const dry = (x, z, r) => TR.heightAt(x, z) > 1.2 && TR.heightAt(x + r, z) > 1.2 && TR.heightAt(x - r, z) > 1.2 && !TR.isOnAnyRunway(x, z, 30);
  const clear = (ax, az, bx, bz) => {
    const n = Math.ceil(Math.hypot(bx - ax, bz - az) / 6);
    for (let i = 0; i <= n; i++) if (!(TR.heightAt(ax + ((bx - ax) * i) / n, az + ((bz - az) * i) / n) > 0.8)) return false;
    return true;
  };
  ok('Kestrel: the town has streets to drive', kp.length >= 2, `${kp.length} streets`);
  const env = { towns: [{ name: 'Kestrel Town', x: T.cx, z: T.cz, r: T.radius }], polylines: kp, tier: 'high', span: 11, ok: dry, clear, onAirfield: (x, z) => TR.isOnAnyRunway(x, z, 400) };
  const mid = kp[Math.floor(kp.length / 2)].pts;
  const sp = mid[Math.floor(mid.length / 2)];
  const a = D.planResponse({ ...env, incident: { x: sp[0], z: sp[1], kind: 'forced' } });
  ok('Kestrel: a forced landing in a town street is answered by road', a.case === 'town' && a.units.length >= 3, `${a.case}, ${a.units && a.units.length} vehicles`);
  ok('...parked on dry land, off the runway', a.units.every((u) => TR.heightAt(u.park.x, u.park.z) > 1 && !TR.isOnAnyRunway(u.park.x, u.park.z, 30)));
  ok('...along Kestrel\'s own streets', a.units.every((u) => D.offNetwork(u.pts, kp, 0, u.roadEnd) < 1));
  ok('...in good time', a.first <= 30 && a.last <= 45, `${a.first.toFixed(0)}-${a.last.toFixed(0)} s`);
  const rw = D.planResponse({ ...env, incident: { x: 0, z: 0, kind: 'crash' } });
  ok('Kestrel: a crash on runway 09 is the airfield\'s (unchanged)', rw.case === 'airport', rw.case);
  ok('Kestrel: the stations stand on dry ground inside the town', [a.stations.fire, a.stations.police].every((s) => TR.heightAt(s.x, s.z) > 1.2 && Math.hypot(s.x - T.cx, s.z - T.cz) < T.radius * 1.25));

  // The World Map: a town's own street plan.
  const P = await import(src + 'world/worldmap/preview.js');
  const G = await import(src + 'world/worldmap/town-grid.js');
  const def = P.previewDef();
  TR.applyMap(def);
  const ctx = G.townContext(P.PREVIEW, TR.FLATS, def.waters.roads);
  const wTowns = P.PREVIEW.towns.map((t) => ({ name: t.name, x: t.cx, z: t.cz, r: t.radius || 400 }));
  let answered = 0;
  let worst = 0;
  let slowest = 0;
  let wet = 0;
  const notes = [];
  for (const F of ctx.towns) {
    const streets = G.townStreets(F).map((s) => ({ pts: s.pts, kind: 'street' }));
    if (!streets.length) continue;
    const roads = def.waters.roads.map((r) => ({ pts: r.path, kind: 'road' }));
    const s0 = streets[Math.floor(streets.length / 2)].pts;
    const at = s0[Math.floor(s0.length / 2)];
    const p = D.planResponse({ towns: wTowns, polylines: [...roads, ...streets], tier: 'high', span: 11, ok: (x, z, r) => TR.heightAt(x, z) > 1.2 && TR.heightAt(x + r, z) > 1.2, clear, runways: [], incident: { x: at[0], z: at[1], kind: 'crash' } });
    if (p.case !== 'town') {
      notes.push(`${F.name}:${p.case}`);
      continue;
    }
    answered++;
    slowest = Math.max(slowest, p.last);
    for (const u of p.units) {
      worst = Math.max(worst, D.offNetwork(u.pts, [...roads, ...streets], 0, u.roadEnd));
      if (!(TR.heightAt(u.park.x, u.park.z) > 1)) wet++;
    }
  }
  ok('the World Map: every town with streets answers a crash in its own street', answered >= 3 && notes.length === 0, `${answered} towns${notes.length ? `, not ${notes.join(' ')}` : ''}`);
  ok('...by its own streets and the island\'s roads, parked dry, inside 45 s', worst < 1 && wet === 0 && slowest <= 45, `worst ${worst.toFixed(2)} m off, ${wet} wet, slowest ${slowest.toFixed(0)} s`);
}

/* ---- 7: the first load ---- */
{
  const IMPORT_RE = /(?:^|\n)\s*(?:import|export)\s+(?:[^'"\n;]*?\s+from\s+)?['"]([^'"]+)['"]/g;
  const seen = new Set();
  const walk = (url) => {
    if (seen.has(url.href)) return;
    seen.add(url.href);
    let text = '';
    try {
      text = readFileSync(url, 'utf8');
    } catch {
      return;
    }
    let m;
    while ((m = IMPORT_RE.exec(text))) if (m[1].startsWith('.')) walk(new URL(m[1], url));
  };
  walk(new URL('../../src/main.js', import.meta.url));
  walk(new URL('../../src/features/index.js', import.meta.url));
  const mine = [...seen].filter((k) => /emergency-scene\/(city|dispatch)\.js$/.test(k));
  ok('first load: city.js and dispatch.js are in nobody\'s static graph', mine.length === 0, mine.join(' '));
  const es = readFileSync(new URL('../../src/features/emergency-scene.js', import.meta.url), 'utf8');
  ok('...emergency-scene.js fetches them once, for an aeroplane in trouble', /a\.crashed \|\| a\.ditched \|\| a\.failures\?\.engine \|\| a\.fuel <= 0 \|\| a\.worstDamage > 0\.3\)\) E\.city = import\('\.\/emergency-scene\/city\.js'\)/.test(es) && /!E\.city &&/.test(es));
  const sw = readFileSync(new URL('../../sw.js', import.meta.url), 'utf8');
  ok('...and both are in the offline list', sw.includes("'src/features/emergency-scene/city.js'") && sw.includes("'src/features/emergency-scene/dispatch.js'"));
  const city = readFileSync(new URL('../../src/features/emergency-scene/city.js', import.meta.url), 'utf8');
  ok('the police bars here always take the soft swell (never the hard pattern)', /FLASH\.reduce = true;\s*try \{\s*flashPolice\(R\.t\);\s*\} finally \{\s*FLASH\.reduce = was;/.test(city));
  ok('nothing here plays a sound or makes a collider', !/addObstacle|playCrash|audio\./.test(city));
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

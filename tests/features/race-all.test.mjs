/**
 * Races for every ride — the rules and the four courses, in node, no browser:
 *
 *   node tests/features/race-all.test.mjs
 *
 * "racing world has: racing for cars, planes, boats etc" (the owner). The
 * Ring Rally (race/rules.js) is one of four courses now (race/courses.js):
 * the car's Fenwick Grand Prix on the town's streets, the boat's Lagoon
 * Regatta between buoys, the helicopter's Skyhook Sprint through low hoops.
 * Measured here, against the real maps:
 *
 *   - every course is on its own island, an island its vehicle can go to;
 *   - THE CAR: every gate and every grid place ON the tarmac of Fenwick's
 *     own authored streets, facing the way the road goes; the lap by road
 *     about two kilometres; a driver following the streets through every
 *     junction passes every gate in order; one wandering ten metres off the
 *     line onto the grass still does (slower, never out);
 *   - THE BOAT: every buoy, every grid place and every metre of the straight
 *     line from gate to gate in deep water, and well clear of the marked pass;
 *   - THE HELICOPTER: every hoop 10-15 m off the ground, the line between
 *     them never under 6 m, lower and smaller than the Ring Rally's, the grid
 *     on the runway;
 *   - the host's rules for each course: the course travels in the state,
 *     gates in order, the time floor is the course's own, the closing time,
 *     the results — and a state without a course is the Ring Rally, as every
 *     state before this was;
 *   - who may race which: the car the car race, the boat the boat race, the
 *     helicopter its own and (as it always could) the Ring Rally; and what
 *     somebody in the wrong vehicle is told.
 */
globalThis.document = globalThis.document || { createElement: () => ({ getContext: () => null, style: {} }) };
const T = await import('../../src/world/terrain.js');
const { MAPS, mapsForGame } = await import('../../src/world/maps.js');
const R = await import('../../src/world/roads.js');
const RR = await import('../../src/features/race/rules.js');
const C = await import('../../src/features/race/courses.js');

const results = [];
const ok = (name, pass, detail = '') => {
  results.push({ name, pass: !!pass });
  console.log(`${pass ? 'PASS' : 'FAIL'} ${name}${detail !== '' ? ` — ${detail}` : ''}`);
  return pass;
};
const deg = (nx, nz) => ((Math.atan2(nx, -nz) * 180) / Math.PI + 360) % 360;
const angleBetween = (a, b) => Math.abs(((a - b + 540) % 360) - 180);

/** Walk a polyline in small steps, counting gates in order the way race.js does. */
function drive(course, frames, path, step = 2) {
  let k = 0;
  const total = RR.totalRings(course);
  let prev = null;
  const passed = [];
  for (let i = 1; i < path.length && k < total; i++) {
    const a = path[i - 1];
    const b = path[i];
    const len = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
    const n = Math.max(1, Math.ceil(len / step));
    for (let j = 1; j <= n && k < total; j++) {
      const p = { x: a.x + ((b.x - a.x) * j) / n, y: a.y + ((b.y - a.y) * j) / n, z: a.z + ((b.z - a.z) * j) / n };
      if (!prev) prev = { ...a };
      const f = frames[RR.ringOf(k, course)];
      if (RR.throughGate(prev.x, prev.y, prev.z, p.x, p.y, p.z, f)) {
        k++;
        passed.push(RR.ringOf(k - 1, course));
      }
      prev = p;
    }
  }
  return { k, passed };
}

/* ---- the four ------------------------------------------------------------------------------ */
ok('four courses: the Ring Rally, the car’s, the boat’s and the helicopter’s', RR.COURSES.length === 4 && RR.COURSES.map((c) => c.vehicle).join() === 'plane,car,boat,heli', RR.COURSES.map((c) => c.id).join());
ok('each on an island of its own', new Set(RR.COURSES.map((c) => c.map)).size === 4 && RR.COURSES.every((c) => RR.courseForMap(c.map) === c) && RR.courseForMap('kestrel') === null);
const gameOf = { plane: 'flight', car: 'car', boat: 'boat', heli: 'heli' };
ok('each island is one its vehicle can go to (the island lists offered for that game)', RR.COURSES.every((c) => mapsForGame(gameOf[c.vehicle]).some((m) => m.id === c.map)),
  RR.COURSES.map((c) => `${c.id}@${c.map}`).join(' '));
ok('each course says its name, which vehicle it is for and which island it is on', RR.COURSES.every((c) => c.name && c.emoji && c.island && MAPS.find((m) => m.id === c.map).name === c.island && RR.VEHICLE_WORDS[c.vehicle]));
ok('the race for each ride: aeroplane → Ring Rally, car → Grand Prix, boat → Regatta, helicopter → Sprint',
  RR.courseForGame('flight').id === 'ring-rally' && RR.courseForGame('car').id === 'car' && RR.courseForGame('boat').id === 'boat' && RR.courseForGame('heli').id === 'heli');
ok('who may race which: cars the car race only, boats the boat race only, the helicopter its own and the Ring Rally',
  RR.rideFits(C.CAR_COURSE, 'car') && !RR.rideFits(C.CAR_COURSE, 'flight') && !RR.rideFits(C.CAR_COURSE, 'boat')
  && RR.rideFits(C.BOAT_COURSE, 'boat') && !RR.rideFits(C.BOAT_COURSE, 'car')
  && RR.rideFits(C.HELI_COURSE, 'heli') && !RR.rideFits(C.HELI_COURSE, 'flight')
  && RR.rideFits(RR.COURSE, 'flight') && RR.rideFits(RR.COURSE, 'heli') && !RR.rideFits(RR.COURSE, 'car'));
ok('somebody in the wrong vehicle is told: "This is a car race — switch to the car"', RR.switchLine(C.CAR_COURSE) === 'This is a car race — switch to the car'
  && RR.switchLine(C.HELI_COURSE) === 'This is a helicopter race — switch to the Skyhook' && RR.switchLine(C.BOAT_COURSE) === 'This is a boat race — switch to the boat',
  RR.COURSES.map((c) => RR.switchLine(c)).join(' / '));

/* ---- the car: Fenwick's streets ----------------------------------------------------------------- */
{
  const c = C.CAR_COURSE;
  T.applyMap(c.map);
  const roads = MAPS.find((m) => m.id === c.map).waters.roads;
  const fr = RR.ringFrames(T.heightAt, c);
  const off = fr.map((f) => R.distanceToRoads(roads, f.x, f.z, 60));
  ok('car: every gate is on the tarmac of Fenwick’s own streets (within a metre of the middle of the road)', off.every((d) => d <= 1.0), off.map((d) => d.toFixed(1)).join(' '));
  // The way the road goes at each gate: the nearest road segment's direction.
  const along = fr.map((f) => {
    let best = null;
    for (const rd of roads) {
      for (let i = 1; i < rd.path.length; i++) {
        const [ax, az] = rd.path[i - 1];
        const [bx, bz] = rd.path[i];
        const ex = bx - ax;
        const ez = bz - az;
        const l2 = ex * ex + ez * ez;
        const t = Math.max(0, Math.min(1, ((f.x - ax) * ex + (f.z - az) * ez) / l2));
        const d = Math.hypot(ax + ex * t - f.x, az + ez * t - f.z);
        if (!best || d < best.d) best = { d, h: deg(ex, ez) };
      }
    }
    const g = deg(f.nx, f.nz);
    return Math.min(angleBetween(g, best.h), angleBetween(g, (best.h + 180) % 360));
  });
  ok('car: every gate faces straight along its road (within 10°)', along.every((a) => a <= 10), along.map((a) => a.toFixed(0)).join(' '));
  const slots = Array.from({ length: 8 }, (_, i) => RR.gridSlot(i, c));
  const sd = slots.map((s) => R.distanceToRoads(roads, s.x, s.z, 60));
  const apart = slots.every((a, i) => slots.every((b, j) => i === j || Math.hypot(a.x - b.x, a.z - b.z) >= 5));
  ok('car: eight places on the grid, all on the tarmac (a 10 m road), two abreast, 5 m or more apart, behind the start line', sd.every((d) => d <= R.PAVED_HALF - 1.5) && apart && slots.every((s) => s.x < fr[fr.length - 1].x),
    sd.map((d) => d.toFixed(1)).join(' '));
  // The lap by road, and a driver following the streets through every junction.
  const pts = fr.map((f) => ({ x: f.x, z: f.z }));
  let lap = 0;
  const path = [{ x: c.grid.x, y: fr[0].y, z: c.grid.z }];
  const leg = (a, b) => R.routeOnRoads(roads, a, b);
  let prevPt = { x: c.grid.x, z: c.grid.z };
  for (let l = 0; l < c.laps; l++) {
    for (let i = 0; i < pts.length; i++) {
      const r = leg(prevPt, pts[i]);
      if (l === 1) lap += R.routeLengthM(r);
      for (const q of r.slice(1)) path.push({ x: q.x, y: T.heightAt(q.x, q.z) + 1, z: q.z });
      prevPt = pts[i];
    }
  }
  // And on over the line a little, the way a car does.
  path.push({ x: prevPt.x + 30, y: path[path.length - 1].y, z: prevPt.z });
  ok('car: a lap by the streets is about two kilometres — two laps, three to four minutes for a kid at 40-50 km/h', lap > 1800 && lap < 2700, `${Math.round(lap)} m a lap`);
  const run = drive(c, fr, path);
  ok('car: a driver following the streets through every junction goes through every gate of both laps, in order', run.k === RR.totalRings(c), `${run.k}/${RR.totalRings(c)}`);
  // Sloppy: 10 m to one side of the line (onto the verge and the grass), and back again, all the way round.
  const wob = path.map((p, i) => {
    const q = path[Math.min(path.length - 1, i + 1)];
    const o = path[Math.max(0, i - 1)];
    const dx = q.x - o.x;
    const dz = q.z - o.z;
    const l = Math.hypot(dx, dz) || 1;
    const s = Math.sin(i / 7) * 10;
    return { x: p.x + (-dz / l) * s, y: p.y, z: p.z + (dx / l) * s };
  });
  const sloppy = drive(c, fr, wob);
  ok('car: gentle — wandering ten metres off the middle of the road (onto the grass) still goes through every gate', sloppy.k === RR.totalRings(c), `${sloppy.k}/${RR.totalRings(c)}`);
  // A shortcut across the grass that misses a gate is a gate missed: the next one does not count until it is back.
  const cut = [{ x: c.grid.x, y: fr[0].y, z: c.grid.z }, { x: fr[0].x + 30, y: fr[0].y, z: fr[0].z }, { x: fr[3].x - 10, y: fr[3].y, z: fr[3].z }, { x: fr[3].x - 60, y: fr[3].y, z: fr[3].z }];
  const cutRun = drive(c, fr, cut);
  ok('car: straight across town from gate 1 to gate 4 misses gates 2 and 3 — gate 4 does not count', cutRun.k === 1, `${cutRun.k} counted`);
}

/* ---- the boat: Coral Lagoon ----------------------------------------------------------------- */
{
  const c = C.BOAT_COURSE;
  T.applyMap(c.map);
  const fr = RR.ringFrames(T.heightAt, c);
  let shallowest = Infinity;
  const pts = [{ x: c.grid.x, z: c.grid.z }, ...fr.map((f) => ({ x: f.x, z: f.z })), fr[0]];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const n = Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 5);
    for (let j = 0; j <= n; j++) shallowest = Math.min(shallowest, -T.heightAt(a.x + ((b.x - a.x) * j) / n, a.z + ((b.z - a.z) * j) / n));
  }
  const buoys = fr.flatMap((f) => RR.gateEnds(f));
  const buoyDepth = Math.min(...buoys.map((p) => -T.heightAt(p.x, p.z)));
  const slots = Array.from({ length: 8 }, (_, i) => RR.gridSlot(i, c));
  const slotDepth = Math.min(...slots.map((s) => -T.heightAt(s.x, s.z)));
  ok('boat: every buoy, every grid place and every metre from gate to gate is deep water (8 m or more)', shallowest >= 8 && buoyDepth >= 8 && slotDepth >= 8,
    `line ${shallowest.toFixed(1)} m, buoys ${buoyDepth.toFixed(1)} m, grid ${slotDepth.toFixed(1)} m`);
  const lagoon = MAPS.find((m) => m.id === c.map);
  const chan = lagoon.waters.channel.path;
  let nearChan = Infinity;
  for (const p of [...pts, ...buoys]) {
    for (let i = 1; i < chan.length; i++) {
      const [ax, az] = chan[i - 1];
      const [bx, bz] = chan[i];
      const ex = bx - ax;
      const ez = bz - az;
      const t = Math.max(0, Math.min(1, ((p.x - ax) * ex + (p.z - az) * ez) / (ex * ex + ez * ez)));
      nearChan = Math.min(nearChan, Math.hypot(ax + ex * t - p.x, az + ez * t - p.z));
    }
  }
  ok('boat: nowhere near the marked pass to the sea (its buoys are not the race’s)', nearChan > 250, `${Math.round(nearChan)} m from it`);
  const berth = T.harbourBerth();
  const fromQuay = Math.hypot(berth.x - c.grid.x, berth.z - c.grid.z);
  ok('boat: the start is just outside the harbour (under 600 m from the quay)', fromQuay < 600, `${Math.round(fromQuay)} m`);
  const lap = RR.lapLength(c);
  ok('boat: a lap is about 1.3 km — two laps, three to four minutes at the launch’s pace', lap > 1000 && lap < 1600, `${Math.round(lap)} m`);
  const path = [{ x: c.grid.x, y: 0.5, z: c.grid.z }];
  for (let k = 0; k < RR.totalRings(c); k++) {
    const f = fr[k % fr.length];
    path.push({ x: f.x - f.nx * 25, y: 0.5, z: f.z - f.nz * 25 });
    path.push({ x: f.x + f.nx * 25, y: 0.5, z: f.z + f.nz * 25 });
  }
  const run = drive(c, fr, path);
  ok('boat: sailed between every pair of buoys, both laps, every one counted in order', run.k === RR.totalRings(c), `${run.k}/${RR.totalRings(c)}`);
  const f0 = fr[0];
  const outside = RR.throughGate(f0.x - f0.nx * 5 - f0.nz * 30, 0.5, f0.z - f0.nz * 5 + f0.nx * 30, f0.x + f0.nx * 5 - f0.nz * 30, 0.5, f0.z + f0.nz * 5 + f0.nx * 30, f0);
  const inside = RR.throughGate(f0.x - f0.nx * 5 - f0.nz * 18, 0.5, f0.z - f0.nz * 5 + f0.nx * 18, f0.x + f0.nx * 5 - f0.nz * 18, 0.5, f0.z + f0.nz * 5 + f0.nx * 18, f0);
  ok('boat: between the buoys counts (18 m off the middle); outside a buoy (30 m) does not', inside && !outside);
}

/* ---- the helicopter: Harrier Flats ----------------------------------------------------------------- */
{
  const c = C.HELI_COURSE;
  T.applyMap(c.map);
  const fr = RR.ringFrames(T.heightAt, c);
  const agl = fr.map((f) => f.y - Math.max(0, T.heightAt(f.x, f.z)));
  let lowest = Infinity;
  for (let i = 0; i < fr.length; i++) {
    const a = fr[i];
    const b = fr[(i + 1) % fr.length];
    const n = Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 5);
    for (let j = 0; j <= n; j++) {
      const x = a.x + ((b.x - a.x) * j) / n;
      const z = a.z + ((b.z - a.z) * j) / n;
      lowest = Math.min(lowest, a.y + ((b.y - a.y) * j) / n - Math.max(0, T.heightAt(x, z)));
    }
  }
  ok('heli: every hoop 10-15 m off the ground, and the line from each to the next never under 6 m', agl.every((h) => h >= 10 && h <= 15) && lowest >= 6, `${agl.map((h) => h.toFixed(0)).join(',')} m; lowest ${lowest.toFixed(1)} m`);
  T.applyMap(RR.COURSE.map);
  const rr = RR.ringFrames(T.heightAt, RR.COURSE);
  const rrAgl = Math.min(...rr.map((f) => f.y - Math.max(0, T.heightAt(f.x, f.z))));
  T.applyMap(c.map);
  ok('heli: lower and tighter than the Ring Rally — smaller hoops, nearer the ground, a shorter lap', c.radius < RR.COURSE.radius / 2 && Math.max(...agl) < rrAgl / 2 && RR.lapLength(c) < RR.lapLength(RR.COURSE) / 1.5,
    `hoops ${c.radius} m vs ${RR.COURSE.radius}, ${Math.max(...agl).toFixed(0)} m up vs ${rrAgl.toFixed(0)}, ${Math.round(RR.lapLength(c))} m vs ${Math.round(RR.lapLength(RR.COURSE))}`);
  const slots = Array.from({ length: 8 }, (_, i) => RR.gridSlot(i, c));
  ok('heli: the grid (helipads) is on the runway', slots.every((s) => T.isOnRunway(s.x, s.z)));
  const path = [{ x: c.grid.x, y: fr[0].y, z: c.grid.z }];
  for (let k = 0; k < RR.totalRings(c); k++) {
    const f = fr[k % fr.length];
    path.push({ x: f.x - f.nx * 20, y: f.y, z: f.z - f.nz * 20 });
    path.push({ x: f.x + f.nx * 20, y: f.y, z: f.z + f.nz * 20 });
  }
  const run = drive(c, fr, path, 1);
  ok('heli: hovered through every hoop of the lap, every one counted in order', run.k === RR.totalRings(c), `${run.k}/${RR.totalRings(c)}`);
  // The check flew the old two laps with a kid's real controls: 6:07 quick (5.2 km, about 14 m/s on
  // average), and a careful pilot (about 9 m/s) still a hoop short at the nine-minute limit.
  const whole = RR.minRaceMs(c) * (c.maxSpeed / 1000);
  const quick = whole / 14;
  const careful = whole / 9;
  const half = whole / 7;
  ok('heli: one lap, about 2.7 km — about three minutes for a quick pilot (like the car and the boat), five for a careful one, and the race alone runs fourteen',
    c.laps === 1 && whole > 2400 && whole < 3000 && quick < 220 && careful < 330 && c.maxMs >= 14 * 60000 && c.maxMs / 1000 > careful * 2.5,
    `${Math.round(whole)} m; quick ${RR.fmtTime(quick * 1000)}, careful ${RR.fmtTime(careful * 1000)}, limit ${RR.fmtTime(c.maxMs)}`);
  ok('heli: a pilot at half the quick one’s speed still finishes inside the closing time (the gentlest of the four)',
    (half - quick) * 1000 < RR.closeMs(c) && RR.COURSES.every((o) => o === c || RR.closeMs(o) < RR.closeMs(c)),
    `${Math.round(half - quick)} s behind; closing ${RR.closeMs(c) / 1000} s`);
  // Each hoop is behind the one before as you fly the course: none has to be flown round to be come at from its far side.
  const faces = fr.map((f, i) => {
    const a = i === 0 ? { x: c.grid.x, z: c.grid.z } : fr[i - 1];
    return (a.x - f.x) * f.nx + (a.z - f.z) * f.nz < 0;
  });
  ok('heli: every hoop faces the one before it — no flying round a hoop to come at it the right way', faces.every(Boolean), faces.map((x) => (x ? 'y' : 'n')).join(''));
}

/* ---- the host, for each course ----------------------------------------------------------------- */
for (const c of RR.COURSES) {
  let t = 0;
  const h = new RR.RaceHost({ now: () => t, course: c });
  const a = h.ask([0, 2, 5], t, c.id);
  const s0 = RR.cleanState(h.state);
  ok(`${c.id}: the grid forms, and the state says which race it is`, a.ok && s0 && s0.c === c.id && s0.s === RR.S.grid);
  t = RR.GRID_MS + 1;
  h.tick(t);
  const total = RR.totalRings(c);
  const wrong = !h.gate(2, h.state.n, 2, t).ok;
  for (let k = 1; k <= total; k++) h.gate(2, h.state.n, k, t);
  const early = !h.done(2, h.state.n, 1000, t + RR.minRaceMs(c) - 500).ok;
  t += RR.minRaceMs(c) + 30000;
  const fin = h.done(2, h.state.n, 0, t);
  for (let k = 1; k <= 3; k++) h.gate(5, h.state.n, k, t);
  t += RR.closeMs(c) - 1000;
  h.tick(t);
  const stillOpen = h.state.s === RR.S.go;
  t += 1001;
  h.tick(t);
  const res = RR.results(h.state);
  ok(`${c.id}: gates in order, the course’s own time floor (${(RR.minRaceMs(c) / 1000).toFixed(0)} s), a finish taken by the host’s clock, the others out at closing time (${RR.closeMs(c) / 1000} s after the winner)`,
    wrong && early && fin.ok && stillOpen && h.state.s === RR.S.done && res[0].id === 2 && res[0].ms === Math.round(RR.minRaceMs(c) + 30000) && res.filter((r) => r.place === null).length === 2,
    JSON.stringify(res));
}
{
  let t = 0;
  const h = new RR.RaceHost({ now: () => t });
  h.ask([0], t, 'car');
  const b = new RR.RaceHost({ now: () => t });
  b.load(h.state, t);
  ok('a new host carries on the race it was handed — the car’s, not the Ring Rally', b.course.id === 'car' && b.state.c === 'car');
  ok('a state with no course is the Ring Rally (every state before this one)', RR.cleanState({ s: 1, n: 1, ent: [0], k: [0], fin: [], out: [] }).c === 'ring-rally');
  ok('a course nobody has heard of is turned away', RR.cleanState({ s: 1, n: 1, c: 'go-karts', ent: [0], k: [0], fin: [], out: [] }) === null);
  ok('a time up to fifteen minutes travels (the slowest car); longer does not', RR.cleanDone({ n: 1, ms: 11 * 60000 }) !== null && RR.cleanDone({ n: 1, ms: 16 * 60000 }) === null);
  ok('every race is called off at least a minute inside the fifteen the wire carries', RR.COURSES.every((o) => (o.maxMs || RR.RACE_MAX_MS) <= RR.RACE_CAP_MS - 60000),
    RR.COURSES.map((o) => `${o.id} ${(o.maxMs || RR.RACE_MAX_MS) / 60000} min`).join(', '));
  // A finish that arrives after the cap (a host that has not ticked) is refused, not written into a state nobody can read.
  let t2 = 0;
  const late = new RR.RaceHost({ now: () => t2, course: C.HELI_COURSE });
  late.ask([0], t2, 'heli');
  t2 = RR.GRID_MS;
  late.tick(t2);
  late.gate(0, late.state.n, 1, t2);
  for (let k = 2; k <= RR.totalRings(C.HELI_COURSE); k++) late.gate(0, late.state.n, k, t2);
  t2 += RR.RACE_CAP_MS + 1;
  const lateDone = late.done(0, late.state.n, 1000, t2);
  ok('a finish past fifteen minutes is refused, and the state stays readable', !lateDone.ok && RR.cleanState(late.state) !== null, JSON.stringify(lateDone));
  ok('the race line’s words: "2 laps", "1 lap"', RR.lapsWord(C.CAR_COURSE) === '2 laps' && RR.lapsWord(C.HELI_COURSE) === '1 lap');
}

const failed = results.filter((r) => !r.pass).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);

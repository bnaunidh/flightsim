/**
 * Street life, in node: the highways' plan, the lanes the cars drive, the rules they
 * drive by, and the people's plan.
 *
 *   node tests/features/street-life.mjs [--quiet]
 *
 *   HIGHWAYS  every dual carriageway on the World Map is read as one link and gets a
 *             flyover: clear of towns, bridges and runway approaches, no steeper than
 *             a ramp is, open underneath, solid where it is solid
 *   LANES     a carriageway is one way, two lanes; a roundabout goes round anticlockwise;
 *             a flyover's lane leaves the inner lane and comes back to it, and is never
 *             joined to the carriageway going the other way or to the road under it
 *   CARS      keep their distance (never into the one in front), slow for the end of
 *             their road, stop for an aeroplane on the ground, are shoved aside when
 *             driven into, park at the kerb clear of the lane, and drive over the deck
 *   PEOPLE    on the pavement, never in the carriageway or on a runway; step back from
 *             the player's aeroplane; none at Low
 */
globalThis.document = globalThis.document || {
  createElement: () => ({ getContext: () => new Proxy({}, { get: () => () => ({ addColorStop() {}, data: new Uint8ClampedArray(4) }) }), width: 0, height: 0, style: {} }),
  body: { appendChild() {} },
  head: { appendChild() {} },
};
globalThis.window = globalThis.window || { addEventListener() {}, devicePixelRatio: 1 };
const store = new Map();
globalThis.localStorage = globalThis.localStorage || { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };

const src = new URL('../../src/', import.meta.url).href;
const THREE = await import(src + 'vendor/three.module.js');
const T = await import(src + 'world/terrain.js');
const { getMap } = await import(src + 'world/maps.js');
const PV = await import(src + 'world/worldmap/preview.js');
const TG = await import(src + 'world/worldmap/town-grid.js');
const H = await import(src + 'world/highway-plan.js');
const LN = await import(src + 'features/ambient/lanes.js');
const CARS = await import(src + 'features/ambient/cars.js');
const AM = await import(src + 'world/ambient.js');
const EXT = await import(src + 'features/ambient.js');
const W = await import(src + 'features/streetlife/walkers.js');
const LOOK = await import(src + 'features/streetlife/highway-look.js');
const { planTown } = await import(src + 'world/scenery.js');
const { makeRandom } = await import(src + 'core/noise.js');

const quiet = process.argv.includes('--quiet');
let passed = 0;
let failed = 0;
const ok = (name, pass, detail = '') => {
  if (pass) passed++;
  else failed++;
  if (!quiet || !pass) console.log(`${pass ? 'PASS' : 'FAIL'} ${name}${detail ? ` -- ${detail}` : ''}`);
};
const t0 = performance.now();

/* ================================================================== */
/* The World Map's highways                                            */
/* ================================================================== */
const def = PV.previewDef();
PV.setDeparture('aldermere');
T.applyMap(def);
const P = PV.PREVIEW;
const roads = T.MAP.waters.roads;
const plan = H.planHighways(roads, { heightAt: T.groundHeightAt, towns: P.towns, airports: P.airports, lift: 0.25 });
{
  const carriageways = roads.filter((r) => r.kind === 'highway').length;
  ok('highways: every pair of carriageways is one link', plan.links.length === carriageways / 2 && plan.links.length >= 7, `${plan.links.length} links from ${carriageways} carriageways`);
  ok('highways: every link has a flyover', plan.flyovers.length === plan.links.length, `${plan.flyovers.length} of ${plan.links.length}`);
  let half = [Infinity, 0];
  for (const l of plan.links) for (const s of l.stations) if (!s.gap && s.s > 60 && s.s < l.length - 60) half = [Math.min(half[0], s.half), Math.max(half[1], s.half)];
  ok('highways: the carriageways run 8 to 10 m either side of the centre line', half[0] > 5.5 && half[1] < 10.5, `${half[0].toFixed(1)} to ${half[1].toFixed(1)} m`);
  let grade = 0;
  let top = Infinity;
  let nearTown = Infinity;
  let nearField = Infinity;
  let nearGap = Infinity;
  let piersInRoad = 0;
  let crossGrade = 0;
  let crossLen = Infinity;
  for (const l of plan.links) {
    const f = l.flyover;
    for (let i = 1; i < f.deck.length; i++) grade = Math.max(grade, Math.abs(f.deck[i].y - f.deck[i - 1].y) / Math.hypot(f.deck[i].x - f.deck[i - 1].x, f.deck[i].z - f.deck[i - 1].z));
    top = Math.min(top, Math.max(...f.deck.map((p) => p.lift)));
    for (const p of f.deck) {
      for (const t of P.towns) nearTown = Math.min(nearTown, Math.hypot(p.x - t.cx, p.z - t.cz) - t.radius);
      for (const a of P.airports) if (Math.abs(p.z - a.z) < 450) nearField = Math.min(nearField, Math.abs(p.x - a.x) - a.length / 2);
    }
    for (const s of l.stations) if (s.gap) nearGap = Math.min(nearGap, Math.min(Math.abs(s.s - f.s0), Math.abs(s.s - f.s1)));
    const mid = (f.s1 - f.s0) / 2;
    for (const p of f.piers) if (Math.abs(p.d - mid) < H.CROSS_HALF + 1) piersInRoad++;
    // (Outside the carriageways: across them it is their own tarmac, each on its own profile.)
    const cm = f.deck[f.deck.length >> 1];
    for (let i = 1; i < f.cross.length; i++) {
      const o = Math.abs((f.cross[i][0] - cm.x) * cm.nx + (f.cross[i][1] - cm.z) * cm.nz);
      if (o > cm.half + 10) crossGrade = Math.max(crossGrade, Math.abs(f.cross[i][2] - f.cross[i - 1][2]) / 5);
    }
    crossLen = Math.min(crossLen, (f.cross.length - 1) * 5);
  }
  ok('flyover: no steeper than 9% anywhere on its deck', grade < 0.09, `${(grade * 100).toFixed(1)}%`);
  ok(`flyover: its top is ${H.FLY_H} m over the ground`, Math.abs(top - H.FLY_H) < 0.05, `${top.toFixed(2)} m`);
  ok('flyover: clear of every town by 150 m', nearTown > 150, `${nearTown.toFixed(0)} m`);
  ok('flyover: out of every runway\'s approach for 3 km', nearField > 3000, `${nearField === Infinity ? 'none in line' : nearField.toFixed(0) + ' m'}`);
  ok('flyover: 150 m and more from a river bridge', nearGap > 150, `${nearGap === Infinity ? 'no bridge on its link' : nearGap.toFixed(0) + ' m'}`);
  ok('flyover: no pier stands in the road underneath', piersInRoad === 0 && plan.flyovers.every((f) => f.piers.length >= 8), `${plan.flyovers[0].piers.length} piers each`);
  ok('flyover: the road underneath crosses both carriageways and climbs no more than 10%', crossGrade <= 0.1 && crossLen >= 2 * (9 + 5 + 6) - 6, `${(crossGrade * 100).toFixed(1)}%, the shortest ${crossLen} m`);

  // Solid where it is solid, open where it is open: an aeroplane's point through each.
  const hit = (f, x, y, z) => f.solids.some((b) => x >= b.x0 && x <= b.x1 && z >= b.z0 && z <= b.z1 && y >= b.y0 && y <= b.y1);
  let under = 0;
  let deckHit = 0;
  let rampHit = 0;
  let pierHit = 0;
  let over = 0;
  for (const f of plan.flyovers) {
    const m = f.deck[f.deck.length >> 1];
    // Along the road underneath, 2.5 m up, under the middle of the top.
    if (!hit(f, m.x, m.ground + 2.5, m.z)) under++;
    if (hit(f, m.x, m.y - 0.3, m.z)) deckHit++;
    if (!hit(f, m.x, m.y + 4, m.z)) over++;
    const r = f.deck.find((p) => p.lift > 1.5 && p.lift < H.WALL_TO - 0.3);
    if (hit(f, r.x, r.ground + 0.6, r.z)) rampHit++;
    const pr = f.piers[0];
    if (hit(f, pr.x, (pr.ground + pr.top) / 2, pr.z)) pierHit++;
  }
  const n = plan.flyovers.length;
  ok('flyover: open under the deck (the road underneath can be driven, and flown)', under === n, `${under} of ${n}; ${plan.flyovers[0].clearance.toFixed(1)} m clear`);
  ok('flyover: the deck, the solid ramp and the piers are crash boxes; the air above is not', deckHit === n && rampHit === n && pierHit === n && over === n, `deck ${deckHit}, ramp ${rampHit}, pier ${pierHit}, clear above ${over}`);

  // The barrier: down the median, never through the flyover or across a river's gap.
  let barrierM = 0;
  let bad = 0;
  for (const l of plan.links) {
    for (const [a, b] of H.barrierRuns(l)) {
      barrierM += l.stations[b].s - l.stations[a].s;
      for (let i = a; i <= b; i++) if (l.stations[i].gap || (l.stations[i].s > l.flyover.s0 && l.stations[i].s < l.flyover.s1)) bad++;
    }
  }
  const total = plan.links.reduce((s, l) => s + l.length, 0);
  ok('barrier: nine tenths of every highway has one, none of it in a flyover or over a river', bad === 0 && barrierM > total * 0.85, `${(barrierM / 1000).toFixed(1)} of ${(total / 1000).toFixed(1)} km`);

  // The look builds (no WebGL needed for geometry).
  const link = plan.links[1];
  const dress = LOOK.buildLinkDress(link, { surface: (x, z) => T.heightAt(x, z) + 0.25, paint: true });
  const fly = LOOK.buildFlyoverLook(link.flyover, {});
  const verts = (g) => {
    let v = 0;
    g.traverse((o) => { if (o.geometry) v += o.geometry.attributes.position.count; });
    return v;
  };
  ok('look: a link is two meshes (barrier, lane paint), a flyover three', dress.children.length === 2 && fly.children.length === 3, `${dress.children.length} + ${fly.children.length}; ${verts(dress)} + ${verts(fly)} vertices; ${dress.userData.dashes} dashes`);
  let finite = true;
  for (const g of [dress, fly]) g.traverse((o) => { if (o.geometry) for (const v of o.geometry.attributes.position.array) if (!Number.isFinite(v)) finite = false; });
  ok('look: every vertex is a number, and near its own group\'s origin', finite && dress.userData.r < 8000);
  const low = LOOK.buildLinkDress(link, { surface: null, paint: false });
  ok('look: Low has the barrier and no paint', low.children.length === 1);
}

/* ================================================================== */
/* The lanes                                                           */
/* ================================================================== */
const ctx = TG.townContext(P, T.FLATS, roads);
const townStreets = [];
for (const F of ctx.towns) for (const st of TG.townStreets(F)) townStreets.push(st);
const flyLanes = plan.flyovers.flatMap((f) => f.lanes);
const tn = performance.now();
const net = LN.buildLanes({ streets: townStreets, roads, town: ctx.towns.map((F) => ({ cx: F.cx, cz: F.cz, r: Math.max(F.hx, F.hz) * 1.15 })), extend: (n) => flyLanes.forEach((l) => n.addLane(l.pts, l.meta)) });
const linkMs = performance.now() - tn;
const S = { x: 0, y: 0, z: 0, i: 0, heading: 0 };
{
  ok('lanes: the whole World Map, every town\'s streets and the flyovers, in under 1.5 s', linkMs < 1500, `${net.lanes.length} lanes, ${net.signals.length} signals, ${linkMs.toFixed(0)} ms`);
  const hw = net.polylines.filter((p) => p.highway);
  let wrong = 0;
  let two = 0;
  for (const p of hw) {
    if (p.lanes.length === 2) two++;
    for (const li of p.lanes) {
      const L = net.lanes[li];
      // The way the lane runs against the way the carriageway was laid.
      const dx = p.pts[p.pts.length - 1][0] - p.pts[0][0];
      const dz = p.pts[p.pts.length - 1][1] - p.pts[0][1];
      if ((L.xs[L.n - 1] - L.xs[0]) * dx + (L.zs[L.n - 1] - L.zs[0]) * dz <= 0 || L.reverse !== -1) wrong++;
    }
  }
  ok('lanes: a carriageway is two lanes, both the way it runs, with no lane back', hw.length === 14 && two === 14 && wrong === 0, `${hw.length} carriageways, ${wrong} lanes against the flow`);
  // Right-hand traffic: the other carriageway is on the left of each.
  let left = 0;
  for (const l of plan.links) {
    const s = l.stations[l.stations.length >> 1];
    // n runs from the first carriageway to the second; the first runs along t: left of t is (tz, -tx).
    if (s.nx * s.tz + s.nz * -s.tx > 0.9) left++;
  }
  ok('lanes: you drive on the right (the other carriageway is on your left)', left === plan.links.length, `${left} of ${plan.links.length}`);
  const rings = net.lanes.filter((l) => l.ring);
  let anti = 0;
  for (const L of rings) {
    let a = 0;
    for (let i = 1; i < L.n; i++) a += L.xs[i - 1] * L.zs[i] - L.xs[i] * L.zs[i - 1];
    if (a < 0) anti++;
  }
  ok('lanes: every roundabout goes round anticlockwise, and round again', rings.length >= 14 && anti === rings.length && rings.every((L) => L.next.length >= 1), `${anti} of ${rings.length}`);
  const fl = net.lanes.map((l, i) => ({ l, i })).filter((q) => q.l.flyover);
  let from = 0;
  let back = 0;
  let cross = 0;
  let high = 0;
  for (const { l, i } of fl) {
    const takers = net.lanes.filter((A) => A.junctions.some((j) => j.lane === i));
    if (takers.length === 1 && takers[0].slot === 1 && takers[0].junctions.find((j) => j.lane === i).p > 0.5) from++;
    if (l.next.length === 1 && net.lanes[l.next[0].lane].slot === 1 && net.lanes[l.next[0].lane].poly === takers[0]?.poly) back++;
    // Nothing else joins it, and it joins nothing going the other way.
    for (const A of net.lanes) if (A.next.some((n) => n.lane === i)) cross++;
    LN.sampleLane(l, l.len / 2, S);
    if (S.y - T.groundHeightAt(S.x, S.z) > H.FLY_H - 0.1) high++;
  }
  ok('lanes: a flyover is left from the inner lane, by most of the traffic, and nowhere else', fl.length === plan.flyovers.length * 2 && from === fl.length, `${from} of ${fl.length}`);
  ok('lanes: it comes back down into the same carriageway\'s inner lane', back === fl.length && cross === 0, `${back} of ${fl.length}; ${cross} lanes end on a flyover`);
  ok('lanes: its middle is the deck, 8 m up', high === fl.length, `${high} of ${fl.length}`);
  // No lane anywhere is joined to one going the other way beside it.
  let uTurn = 0;
  for (const A of net.lanes) {
    if (!A.oneWay || A.ring) continue;
    for (const j of A.junctions) {
      const B = net.lanes[j.lane];
      LN.sampleLane(A, j.s, S);
      const ha = S.heading;
      LN.sampleLane(B, 0, S);
      if (Math.abs((((ha - S.heading) % 360) + 540) % 360 - 180) > 100) uTurn++;
    }
  }
  ok('lanes: nobody turns off a carriageway against the traffic', uTurn === 0, `${uTurn}`);
  // Signals: in the towns, where their streets cross; none on a highway, a roundabout or a flyover.
  let onHighway = 0;
  let outOfTown = 0;
  for (const sg of net.signals) {
    if (!ctx.towns.some((F) => Math.hypot(sg.x - F.cx, sg.z - F.cz) <= Math.max(F.hx, F.hz) * 1.15)) outOfTown++;
    for (const li of sg.lanes) if (net.lanes[li].oneWay) onHighway++;
  }
  ok('lanes: traffic lights stand in the towns, none on a carriageway', net.signals.length > 20 && outOfTown === 0 && onHighway === 0, `${net.signals.length} signals; ${outOfTown} out of town, ${onHighway} stop lines on one-way lanes`);
}

/* ================================================================== */
/* The cars                                                            */
/* ================================================================== */
const group = new THREE.Group();
/** The four corners of a car, for the overlap test. */
function overlap(a, b) {
  const d = Math.hypot(a.px - b.px, a.pz - b.pz);
  if (d > (a.len + b.len) / 2) return false;
  if (Math.abs(a.py - b.py) > 2) return false;
  // Separating axes of two boxes on the ground.
  const box = (c) => {
    const h = (c.heading * Math.PI) / 180;
    const k = CARS.KINDS[c.shape];
    return { x: c.px, z: c.pz, fx: Math.sin(h), fz: -Math.cos(h), hl: k.L / 2 - 0.15, hw: k.W / 2 - 0.15 };
  };
  const A = box(a);
  const B = box(b);
  for (const [ux, uz] of [[A.fx, A.fz], [-A.fz, A.fx], [B.fx, B.fz], [-B.fz, B.fx]]) {
    const ext = (C) => C.hl * Math.abs(C.fx * ux + C.fz * uz) + C.hw * Math.abs(-C.fz * ux + C.fx * uz);
    if (Math.abs((B.x - A.x) * ux + (B.z - A.z) * uz) > ext(A) + ext(B)) return false;
  }
  return true;
}
{
  const fly = plan.flyovers[0];
  const layer = new CARS.CarLayer(group, net, { shadows: false, variety: true, ground: T.heightAt });
  layer.populate('car', 110, { laneKinds: ['street', 'road'] });
  layer.populate('truck', 14, { laneKinds: ['road'] });
  layer.populate('bus', 6, { laneKinds: ['street', 'road'] });
  layer.populate('police', 2, { laneKinds: ['street'] });
  layer.populate('car', 40, { kerb: true });
  layer.setFollow(true);
  layer.build();
  const cam = { x: fly.mid.x + 120, y: fly.mid.y + 150, z: fly.mid.z + 200 };
  const DT = 1 / 30;
  let sameLane = 0;
  let boxes = 0;
  let frames = 0;
  let onDeck = 0;
  let near = 0;
  let wrongWay = 0;
  let fastEnd = 0;
  let endChecks = 0;
  const deckCars = new Set();
  const cost = [];
  for (let f = 0; f < 30 * 240; f++) {
    const t1 = performance.now();
    layer.update(DT, cam, f > 30 * 200, null);
    if (f > 200) cost.push(performance.now() - t1);
    if (f < 30 * 20) continue; // the cars are still being brought to the highway
    const cs = layer.cars;
    if (f % 3 === 0) {
      frames++;
      const act = cs.filter((c) => c.dist < 1500);
      near += act.length;
      for (let i = 0; i < act.length; i++) {
        const a = act[i];
        for (let j = i + 1; j < act.length; j++) {
          const b = act[j];
          if (Math.abs(a.px - b.px) > 14 || Math.abs(a.pz - b.pz) > 14) continue;
          if (a.lane >= 0 && a.lane === b.lane && !a.parked && !b.parked && Math.abs(a.s - b.s) < (a.len + b.len) / 2 - 0.05) sameLane++;
          if (overlap(a, b)) boxes++;
        }
        if (!a.parked && a.lane >= 0) {
          const L = net.lanes[a.lane];
          if (L.flyover && a.py - T.groundHeightAt(a.px, a.pz) > 6) {
            onDeck++;
            deckCars.add(a.idx);
          }
          // On a carriageway: going the way it goes.
          if (L.oneWay && !L.ring && !L.flyover) {
            const Pp = net.polylines[L.poly].pts;
            const h = (a.heading * Math.PI) / 180;
            const k = Math.min(Pp.length - 2, Math.max(0, Math.round((a.s / L.len) * (Pp.length - 1)) - 1));
            if (Math.sin(h) * (Pp[k + 1][0] - Pp[k][0]) - Math.cos(h) * (Pp[k + 1][1] - Pp[k][1]) < 0) wrongWay++;
          }
          // At the end of a road that does not go straight on: down to half pace.
          if (L.slow && L.slow.length && L.slow[L.slow.length - 1] === L.len && a.s > L.len - 4 && a.lead < 0) {
            endChecks++;
            if (a.speed > a.want * 0.62) fastEnd++;
          }
        }
      }
    }
  }
  ok('cars: brought to where the player is on a map too big to fill', near / frames > 60, `${(near / frames).toFixed(0)} of ${layer.cars.length} within 1.5 km of the camera, ${layer.follow.moved} moves`);
  ok('cars: never into the back of the one in front (same lane, bumper to bumper)', sameLane === 0, `${sameLane} overlaps in ${frames} frames`);
  ok('cars: bodies overlap less than once in 2,000 car-frames (lane joins)', boxes / near < 0.0005, `${boxes} in ${near} car-frames (${((boxes / near) * 100).toFixed(4)}%)`);
  ok('cars: drive over the flyover\'s deck', deckCars.size >= 3, `${deckCars.size} cars, ${onDeck} car-frames on the deck`);
  ok('cars: keep to their carriageway\'s direction', wrongWay === 0, `${wrongWay}`);
  ok('cars: none arrives fast at the end of a road', fastEnd === 0, `${fastEnd} of ${endChecks}`);
  const st = layer.stats;
  ok('cars: night shows head and tail lamps on the ones driven, none on the parked', st.tails > 0 && st.tails <= layer.cars.filter((c) => !c.kerb).length * 2, `${st.tails} lamps`);
  // (The median and the 90th percentile: this Mac stops background work for moments at a time, and that is not the game's cost.)
  cost.sort((a, b) => a - b);
  ok('cars: a frame of 172 costs well under a millisecond', cost[cost.length >> 1] < 0.6 && cost[Math.floor(cost.length * 0.9)] < 1.5, `${cost[cost.length >> 1].toFixed(3)} ms median, ${cost[Math.floor(cost.length * 0.9)].toFixed(3)} ms at the 90th percentile, ${cost[Math.floor(cost.length * 0.99)].toFixed(3)} at the 99th`);
  const shapes = new Set(layer.cars.map((c) => c.shape));
  ok('cars: saloons, hatchbacks, pick-ups, trucks, buses and a police car', ['car', 'hatch', 'pickup', 'truck', 'bus', 'police'].every((k) => shapes.has(k)), [...shapes].join(' '));
  ok('cars: every kind has a shape', Object.keys(CARS.KINDS).every((k) => k === 'firetruck' || CARS.carShape(k, 0xffffff).attributes.position.count > 100));
  layer.dispose();
}

/* ---- the end of the road ---- */
{
  // A country road's lane into its last junction: not straight on, so slowed for.
  const li = net.lanes.findIndex((l) => !l.oneWay && l.kind === 'road' && l.len > 400 && l.slow.length && l.slow[l.slow.length - 1] === l.len);
  const L = net.lanes[li];
  const layer = new CARS.CarLayer(group, { lanes: net.lanes, signals: [], polylines: net.polylines }, {});
  layer.populate('car', 1, { laneKinds: ['road'] });
  const c = layer.cars[0];
  c.lane = li;
  c.s = L.len - 160;
  layer.build();
  LN.sampleLane(L, L.len, S);
  const cam = { x: S.x, y: 40, z: S.z };
  let cruise = 0;
  let atEnd = Infinity;
  for (let f = 0; f < 30 * 40 && c.lane === li; f++) {
    layer.update(1 / 30, cam, false, null);
    if (c.lane !== li) break;
    if (c.s < L.len - 60) cruise = Math.max(cruise, c.speed);
    if (c.s > L.len - 5) atEnd = Math.min(atEnd, c.speed);
  }
  ok('cars: slow to about half pace for the end of their road', cruise > c.want * 0.9 && atEnd < c.want * 0.62 && atEnd > 2, `${cruise.toFixed(1)} m/s on the road, ${atEnd.toFixed(1)} m/s at its end`);
  layer.dispose();
}

/* ---- an aeroplane on the road, and being driven into ---- */
{
  const li = net.lanes.findIndex((l) => l.oneWay && !l.ring && !l.flyover && l.len > 3000);
  const L = net.lanes[li];
  const one = { lanes: net.lanes, signals: [], polylines: net.polylines };
  const layer = new CARS.CarLayer(group, one, { ground: T.heightAt });
  layer.populate('car', 1, { laneKinds: ['road'] });
  const c = layer.cars[0];
  c.lane = li;
  c.s = 600;
  c.pool = [li];
  layer.build();
  LN.sampleLane(L, 900, S);
  const plane = { x: S.x, z: S.z, kind: 'plane', r: 17, speed: 0, vx: 0, vz: 0 };
  const cam = { x: S.x, y: 50, z: S.z };
  let closest = Infinity;
  for (let f = 0; f < 30 * 60; f++) {
    layer.update(1 / 30, cam, false, plane);
    closest = Math.min(closest, Math.hypot(c.px - plane.x, c.pz - plane.z));
  }
  ok('cars: stop for an aeroplane stood on the road, short of its wingtip', c.speed === 0 && closest > 17 + 2 && closest < 17 + 12, `stopped ${closest.toFixed(1)} m from its middle (half span 17 m)`);
  // It moves off: so does the car.
  plane.x += 4000;
  for (let f = 0; f < 30 * 8; f++) layer.update(1 / 30, cam, false, plane);
  ok('cars: and drive on when it has gone', c.speed > 5, `${c.speed.toFixed(1)} m/s`);
  // Driven into at 20 m/s from behind and a little to one side.
  const h = (c.heading * Math.PI) / 180;
  const before = { x: c.px, z: c.pz };
  const ram = { x: c.px - Math.sin(h) * 3 + Math.cos(h) * 0.6, z: c.pz + Math.cos(h) * 3 + Math.sin(h) * 0.6, kind: 'plane', r: 5, speed: 20, vx: Math.sin(h) * 20, vz: -Math.cos(h) * 20 };
  layer.update(1 / 30, cam, false, ram);
  const knocked = c.knock;
  ram.x += 5000;
  let moving = 0;
  for (let f = 0; f < 30 * 6; f++) {
    layer.update(1 / 30, cam, false, ram);
    if (c.knock) moving++;
  }
  const went = Math.hypot(c.px - before.x, c.pz - before.z);
  ok('cars: driven into at speed, a car is shoved aside and slides to a stop', knocked && !c.knock && went > 4 && went < 40 && moving > 20 && Number.isFinite(c.py) && c.parked, `${went.toFixed(1)} m in ${(moving / 30).toFixed(1)} s`);
  ok('cars: one hit, counted once', layer.stats.hits === 1, `${layer.stats.hits}`);
  layer.dispose();
}

/* ---- the classic maps: parked at the kerb, and what each tier gets ---- */
{
  const X = EXT.TOWN_EXTRAS;
  ok('tiers: Low gets no kerb cars, no extra town cars and no police; more with every tier', X.low.kerb === 0 && X.low.cars === 0 && X.low.police === 0 && X.medium.kerb < X.high.kerb && X.high.kerb < X.ultra.kerb && X.medium.cars < X.high.cars && X.high.cars < X.ultra.cars);
  ok('tiers: Low gets no people; more with every tier', W.PEOPLE.low === 0 && W.PEOPLE.medium < W.PEOPLE.high && W.PEOPLE.high < W.PEOPLE.ultra && W.PEOPLE.ultra <= W.PEOPLE_CAP);
  const rows = [];
  for (const id of ['kestrel', 'gateway', 'town', 'meadow']) {
    T.applyMap(getMap(id));
    const world = EXT.buildAmbientWorld({ mapId: id, quality: 'high', roads: (T.MAP.waters && T.MAP.waters.roads) || [] });
    const layer = new CARS.CarLayer(group, world.net, { variety: true, ground: T.heightAt });
    layer.populate('car', 14, { laneKinds: ['street', 'road'] });
    const parked = layer.populate('car', EXT.TOWN_EXTRAS.high.kerb, { kerb: true });
    layer.build();
    let inLane = 0;
    let onStrip = 0;
    let tooClose = 0;
    const kerb = layer.cars.filter((c) => c.kerb);
    for (const c of kerb) {
      if (T.isOnAnyRunway(c.px, c.pz, 8)) onStrip++;
      // Clear of every driving line by a car's width and a bit.
      for (const Ln of world.net.lanes) {
        if (c.px < Ln.x0 - 3 || c.px > Ln.x1 + 3 || c.pz < Ln.z0 - 3 || c.pz > Ln.z1 + 3) continue;
        if (LN.nearestOnLane(Ln, c.px, c.pz).d < 1.7) inLane++;
      }
      for (const o of kerb) if (o !== c && Math.hypot(o.px - c.px, o.pz - c.pz) < 5) tooClose++;
    }
    // And the traffic passes them: a minute of driving, nobody stuck behind a parked car.
    const cam = { x: T.MAP.scenery.town.cx, y: 80, z: T.MAP.scenery.town.cz };
    let stuck = 0;
    let boxes = 0;
    for (let f = 0; f < 30 * 90; f++) {
      layer.update(1 / 30, cam, false, null);
      if (f % 5 === 0) for (const a of layer.cars) for (const b of layer.cars) if (a.idx < b.idx && (!a.kerb || !b.kerb) && Math.abs(a.px - b.px) < 12 && Math.abs(a.pz - b.pz) < 12 && overlap(a, b)) boxes++;
    }
    for (const c of layer.cars) if (!c.parked && c.idle > 20) stuck++;
    rows.push(`${id} ${parked}`);
    ok(`${id}: cars parked at the kerb are out of every lane, off the runway, and apart`, inLane === 0 && onStrip === 0 && tooClose === 0, `${parked} parked; ${inLane} in a lane, ${onStrip} by a runway, ${tooClose} touching`);
    ok(`${id}: the traffic gets past them`, stuck === 0 && boxes < 12, `${stuck} stuck, ${boxes} body overlaps in 90 s`);
    layer.dispose();
  }
  ok('kerbs: at least two of these towns have streets wide enough to park on', rows.filter((r) => Number(r.split(' ')[1]) > 4).length >= 2, rows.join(', '));
}

/* ================================================================== */
/* The people                                                          */
/* ================================================================== */
{
  for (const id of ['kestrel', 'gateway']) {
    T.applyMap(getMap(id));
    const town = T.MAP.scenery.town;
    const streets = (planTown(town, 1).streets || []).filter((s) => s.drawn).map((s) => ({ pts: s.pts, hw: s.hw || 5, walk: 2.2 }));
    const blocked = (x, z) => T.heightAt(x, z) < 0.6 || T.isOnAnyRunway(x, z, 30);
    const p = W.planWalkers(streets, { count: 64, centre: { x: town.cx, z: town.cz, r: town.radius }, ground: T.heightAt, blocked, rnd: makeRandom(5) });
    let inRoad = 0;
    let onStrip = 0;
    let wet = 0;
    for (const w of p) {
      for (const q of w.path) {
        if (T.isOnAnyRunway(q.x, q.z, 30)) onStrip++;
        if (T.heightAt(q.x, q.z) < 0.6) wet++;
      }
      // The pavement is outside the carriageway of the street they are on.
      const st = streets[w.street];
      for (const q of w.path) {
        let d = Infinity;
        for (let k = 1; k < st.pts.length; k++) {
          const ax = st.pts[k - 1][0];
          const az = st.pts[k - 1][1];
          const ex = st.pts[k][0] - ax;
          const ez = st.pts[k][1] - az;
          const t = Math.max(0, Math.min(1, ((q.x - ax) * ex + (q.z - az) * ez) / (ex * ex + ez * ez || 1)));
          d = Math.min(d, Math.hypot(ax + ex * t - q.x, az + ez * t - q.z));
        }
        if (d < st.hw + 0.4) inRoad++;
      }
    }
    const walking = p.filter((w) => w.mode === 'walk').length;
    ok(`${id}: 64 people planned, most walking, some stood about`, p.length === 64 && walking > 30 && walking < 60, `${walking} walking, ${p.length - walking} standing`);
    ok(`${id}: on the pavement — none in the carriageway, on a runway or in the water`, inRoad === 0 && onStrip === 0 && wet === 0, `${inRoad} / ${onStrip} / ${wet}`);
    const inner = p.filter((w) => Math.hypot(w.path[0].x - town.cx, w.path[0].z - town.cz) < town.radius * 0.5).length;
    ok(`${id}: more of them in the middle of town`, inner > p.length * 0.4, `${inner} of ${p.length} within half its radius (a quarter of its area)`);
    const sw = new W.StreetWalkers(p, makeRandom(9));
    let off = 0;
    for (let f = 0; f < 30 * 120; f++) {
      sw.step(1 / 30, null, 1);
      if (f % 30 === 0) for (const q of sw.people) {
        if (q.w.mode !== 'walk') continue;
        let d = Infinity;
        for (const a of q.w.path) d = Math.min(d, Math.hypot(a.x - q.x, a.z - q.z));
        if (d > 4.5 || !Number.isFinite(q.x + q.y + q.z + q.yaw)) off++;
      }
    }
    const moved = sw.people.filter((q) => q.w.mode === 'walk' && q.walk > 20).length;
    ok(`${id}: they walk their own stretch of pavement and nowhere else`, off === 0 && moved === walking, `${moved} walked, ${off} off their path`);
    // The player's aeroplane taxis up to one of them.
    const who = sw.people.find((q) => q.w.mode === 'walk');
    const danger = { x: who.x + 3, z: who.z, r: 5 };
    const at = { x: who.x, z: who.z };
    for (let f = 0; f < 60; f++) sw.step(1 / 30, danger, 1);
    const back = Math.hypot(who.x - danger.x, who.z - danger.z) - Math.hypot(at.x - danger.x, at.z - danger.z);
    ok(`${id}: a person steps back from the player's aeroplane, and stops walking`, sw.shied >= 1 && back > 1.2 && !who.moving, `${back.toFixed(1)} m further off; ${sw.shied} shied`);
    for (let f = 0; f < 90; f++) sw.step(1 / 30, null, 1);
    ok(`${id}: and carries on when it has gone`, who.away < 0.05 && sw.shied === 0);
    sw.step(1 / 30, null, 0.35);
    ok(`${id}: a third of them out after dark`, sw.people.filter((q) => !q.hidden).length === Math.ceil(p.length * 0.35));
  }
  ok('people: none planned where there is no street', W.planWalkers([], { count: 20 }).length === 0);
}

console.log(`\n${passed} passed, ${failed} failed, ${(performance.now() - t0).toFixed(0)} ms`);
process.exit(failed ? 1 : 0);

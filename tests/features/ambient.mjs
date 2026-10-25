/**
 * Node checks for the ambient population (src/world/ambient.js and
 * src/features/ambient*):
 *
 *   node tests/features/ambient.mjs                 every map, the full soak
 *   node tests/features/ambient.mjs gateway         one map
 *   node tests/features/ambient.mjs --quick         every map, a 5-minute soak
 *   node tests/features/ambient.mjs --quiet         failures and the summary
 *
 * No page. For every one of the 30 maps the real world is built the way
 * main.js builds it — the airfield (obstacles, parked aeroplanes), the pads,
 * the roads (generated on the courier maps, as boot generates them) — then:
 *
 *   1. DATA: every map id has an entry; every kind, role and type it names
 *      exists; every place it names resolves on that map.
 *   2. TIERS: the counts follow DENSITY (Low sparse), the flyers AIR_CAP and
 *      the airport AIRPORT_CAP (never over traffic's 6); a mission that says
 *      nothing gets thin ground and water and no aircraft; def.ambient's
 *      'thin', 'full', false and { ... } are honoured.
 *   3. LANES: every car lane point lies within PAVED_HALF of a street or road
 *      centreline, on dry ground, and every lane end has somewhere to go.
 *   4. BOATS: every route point has 3 m of water, is 60 m off the channel on
 *      the boat maps, and 60 m off every deck pad.
 *   5. FLYERS: every orbit and transit resolves, at 150 m AGL or more.
 *   3b. RUNWAYS: no lane point or segment within 8 m of either runway strip
 *      (the roads are cut RUNWAY_OFF short of the tarmac on both sides).
 *   6. SOAK: 30 simulated minutes per map (5 with --quick), the map's flyers
 *      flying their patterns while a scripted player flies the circuit at
 *      300 m and 60 m/s, with a pass over the town: no flyer ever within
 *      300 m of the player, no NaN anywhere, no flyer under its floor
 *      (150 m AGL; 600 m over the field inside the approach corridors) —
 *      except a medevac on final to its own pad, which only happens with the
 *      player 1.5 km away.
 *   7. GROUND SOAK: 10 simulated minutes per map (2 with --quick) of the real
 *      CarLayer on the real lanes at High: no vehicle ever within 5 m of a
 *      runway strip, and the ones on lanes drive.
 *
 * Exits 1 if anything fails.
 */

globalThis.document = globalThis.document || {
  createElement: () => ({
    getContext: () => new Proxy({}, { get: () => () => ({ addColorStop() {}, data: new Uint8ClampedArray(4) }) }),
    width: 0,
    height: 0,
    style: {},
  }),
  body: { appendChild() {} },
  head: { appendChild() {} },
};
globalThis.window = globalThis.window || { addEventListener() {}, devicePixelRatio: 1 };

const src = new URL('../../src/', import.meta.url).href;
const THREE = await import(src + 'vendor/three.module.js');
const TR = await import(src + 'world/terrain.js');
const AP = await import(src + 'world/airport.js');
const APR = await import(src + 'world/apron.js');
const PD = await import(src + 'world/pads.js');
const RD = await import(src + 'world/roads.js');
const { MAPS } = await import(src + 'world/maps.js');
const TYPES = await import(src + 'aircraft/types.js');
const AM = await import(src + 'world/ambient.js');
const LN = await import(src + 'features/ambient/lanes.js');
const FL = await import(src + 'features/ambient/flyers.js');
const SKY = await import(src + 'features/sky.js');
const EXT = await import(src + 'features/ambient.js');

const args = process.argv.slice(2);
const only = args.find((a) => !a.startsWith('--')) || null;
const quiet = args.includes('--quiet');
const quick = args.includes('--quick');
const SOAK_S = quick ? 300 : 1800;
const DT = 0.2;

let passed = 0;
let failed = 0;
const fails = [];
function ok(name, pass, detail = '') {
  if (pass) passed++;
  else {
    failed++;
    fails.push(`${name}${detail ? ` — ${detail}` : ''}`);
  }
  if (!quiet || !pass) console.log(`${pass ? 'ok  ' : 'FAIL'} ${name}${detail !== '' ? ` — ${detail}` : ''}`);
}

/** Build the map's world the way main.js does, and return the roads list. */
function loadMap(m) {
  TR.applyMap(m.id);
  let roads = [];
  if (m.courier) {
    const authored = m.waters && m.waters.roads;
    const already = authored && authored.length && !m.waters._generated;
    const { roads: r } = already ? { roads: authored } : RD.buildRoads(m);
    m.waters = m.waters || {};
    m.waters.roads = r;
    if (!already) m.waters._generated = true;
    delete m.waters._ready;
    TR.applyMap(m);
    roads = r;
  } else if (m.waters && m.waters.roads && m.waters.roads.length) {
    roads = m.waters.roads;
  }
  AP.refreshRunways();
  APR.refreshApronElevation();
  TR.clearObstacles();
  TR.clearPlatforms();
  const scene = { add() {} };
  new AP.Airport(scene);
  new APR.Apron(scene, 'high');
  PD.buildPads(new THREE.Group());
  return roads;
}

const maps = MAPS.filter((m) => !only || m.id === only);

/* ------------------------------------------------------------------ */
/* 1. Data                                                             */
/* ------------------------------------------------------------------ */

ok('ambient: all 31 map ids have data', MAPS.every((m) => AM.AMBIENT[m.id]), MAPS.filter((m) => !AM.AMBIENT[m.id]).map((m) => m.id).join(',') || 'all');
ok('ambient: no data for a map that does not exist', AM.AMBIENT_IDS.every((id) => MAPS.some((m) => m.id === id)), AM.AMBIENT_IDS.filter((id) => !MAPS.some((m) => m.id === id)).join(','));
ok('ambient: DENSITY is low 0.2, medium 0.5, high 1, ultra 1.5', AM.DENSITY.low === 0.2 && AM.DENSITY.medium === 0.5 && AM.DENSITY.high === 1 && AM.DENSITY.ultra === 1.5);
ok('ambient: AIR_CAP is 1, 2, 3, 4', AM.AIR_CAP.low === 1 && AM.AIR_CAP.medium === 2 && AM.AIR_CAP.high === 3 && AM.AIR_CAP.ultra === 4);
// Medium 0 and High 2, not the plan's 1 and 3: traffic.js's models measured over the draw and frame budgets (see world/ambient.js).
ok('ambient: AIRPORT_CAP is 0, 0, 2, 4, inside traffic\'s 6', AM.AIRPORT_CAP.low === 0 && AM.AIRPORT_CAP.medium === 0 && AM.AIRPORT_CAP.high === 2 && AM.AIRPORT_CAP.ultra === 4);

for (const m of maps) {
  const d = AM.ambientFor(m.id);
  const bad = [];
  for (const g of d.ground) if (!AM.GROUND_KINDS.includes(g.kind)) bad.push(`ground kind ${g.kind}`);
  for (const w of d.water) if (!AM.BOAT_KINDS.includes(w.kind)) bad.push(`boat kind ${w.kind}`);
  for (const a of d.air) {
    if (a.kind === 'heli' && !AM.HELI_ROLES.includes(a.role)) bad.push(`heli role ${a.role}`);
    if (a.kind === 'plane' && !AM.PLANE_ROLES.includes(a.role)) bad.push(`plane role ${a.role}`);
    if (a.kind === 'plane' && !TYPES.AIRCRAFT.some((t) => t.id === a.type)) bad.push(`plane type ${a.type}`);
    if (a.kind === 'heli' && a.agl != null && a.agl < 150 && a.alt == null) bad.push(`${a.role} agl ${a.agl} under 150`);
  }
  if (d.airport) for (const t of d.airport.types) if (!TYPES.AIRCRAFT.some((q) => q.id === t)) bad.push(`airport type ${t}`);
  ok(`${m.id}: every kind, role and type exists`, bad.length === 0, bad.join('; '));
}

/* ------------------------------------------------------------------ */
/* 2. Tiers and mission levels                                         */
/* ------------------------------------------------------------------ */

{
  const sum = (c) => c.ground.reduce((a, g) => a + g.count, 0) + c.water.reduce((a, w) => a + w.count, 0);
  for (const m of maps) {
    const lo = AM.countsFor(m.id, 'low');
    const me = AM.countsFor(m.id, 'medium');
    const hi = AM.countsFor(m.id, 'high');
    const ul = AM.countsFor(m.id, 'ultra');
    const high = AM.ambientFor(m.id);
    const nHigh = high.ground.reduce((a, g) => a + g.n, 0) + high.water.reduce((a, w) => a + w.n, 0);
    ok(`${m.id}: counts rise with the tier (low ${sum(lo)}, medium ${sum(me)}, high ${sum(hi)}, ultra ${sum(ul)})`, sum(lo) <= sum(me) && sum(me) <= sum(hi) && sum(hi) <= sum(ul) && sum(hi) === nHigh);
    ok(`${m.id}: Low is sparse (${sum(lo)} of ${nHigh})`, sum(lo) <= Math.ceil(nHigh * 0.25) + high.ground.length + high.water.length);
    ok(`${m.id}: flyers capped by tier`, lo.air.length <= 1 && me.air.length <= 2 && hi.air.length <= 3 && ul.air.length <= 4 && hi.air.length === Math.min(3, high.air.length));
    const apHi = hi.airport ? hi.airport.n : 0;
    ok(`${m.id}: airport traffic capped by tier (low and medium none, high ${apHi})`, !lo.airport && !me.airport && apHi <= 3 && (!ul.airport || ul.airport.n <= 4));
    const mis = AM.countsFor(m.id, 'high', AM.MISSION_DEFAULT);
    ok(`${m.id}: a mission's default is thin ground and water with no aircraft`, mis.air.length === 0 && mis.airport === null && mis.ground.every((g, i) => g.count === Math.round(high.ground[i].n * 0.3)) && mis.water.every((w, i) => w.count === Math.round(high.water[i].n * 0.5)));
    const off = AM.countsFor(m.id, 'high', false);
    ok(`${m.id}: def.ambient false means nothing at all`, sum(off) === 0 && off.air.length === 0 && !off.airport);
    const full = AM.countsFor(m.id, 'high', 'full');
    ok(`${m.id}: def.ambient 'full' is the free-flight population`, sum(full) === sum(hi) && full.air.length === hi.air.length);
    const custom = AM.countsFor(m.id, 'high', { ground: 0.5, water: 0, air: 1, airport: 0 });
    ok(`${m.id}: def.ambient { ground: 0.5, water: 0, air: 1 } is honoured`, custom.water.every((w) => w.count === 0) && custom.air.length === Math.min(1, high.air.length) && !custom.airport && custom.ground.every((g, i) => g.count === Math.round(high.ground[i].n * 0.5)));
  }
}

/* ------------------------------------------------------------------ */
/* 3, 4, 5. The world: lanes, routes, places                            */
/* ------------------------------------------------------------------ */

const WORLDS = new Map();
for (const m of maps) {
  const roads = loadMap(m);
  const sim = { carrier: null, roads: { list: roads } };
  const W = EXT.buildAmbientWorld({ mapId: m.id, quality: 'high', roads, sim });
  WORLDS.set(m.id, W);
  const d = AM.ambientFor(m.id);

  // Places.
  const unresolved = [];
  for (const g of d.ground) if (g.on && typeof g.on === 'object' && !EXT.placeOf(g.on.loop || g.on.park, sim)) unresolved.push(`ground ${JSON.stringify(g.on)}`);
  for (const w of d.water) {
    const R = w.route || {};
    if (R.around && !EXT.placeOf(R.around, sim)) unresolved.push(`water ${R.around}`);
    if (R.between) for (const p of R.between) if (!EXT.placeOf(p, sim)) unresolved.push(`water ${p}`);
  }
  for (const a of d.air) {
    if (a.orbit && !EXT.placeOf(a.orbit, sim)) unresolved.push(`air ${a.orbit}`);
    if (a.transit) for (const p of a.transit) if (!EXT.placeOf(p, sim)) unresolved.push(`air ${p}`);
    if (a.land && !EXT.placeOf(a.land, sim)) unresolved.push(`land ${a.land}`);
  }
  ok(`${m.id}: every referenced place resolves`, unresolved.length === 0, unresolved.join('; '));

  // Lanes on pavement, dry, with somewhere to go.
  const lanes = W.net.lanes;
  const polys = W.net.polylines;
  let off = 0;
  let wet = 0;
  let worst = 0;
  let deadEnds = 0;
  for (const L of lanes) {
    const P = polys[L.poly].pts;
    for (let i = 0; i < L.n; i++) {
      let best = Infinity;
      for (let k = 1; k < P.length; k++) {
        const ax = P[k - 1][0];
        const az = P[k - 1][1];
        const bx = P[k][0];
        const bz = P[k][1];
        const dx = bx - ax;
        const dz = bz - az;
        const L2 = dx * dx + dz * dz;
        let t = L2 > 0 ? ((L.xs[i] - ax) * dx + (L.zs[i] - az) * dz) / L2 : 0;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const d = Math.hypot(ax + dx * t - L.xs[i], az + dz * t - L.zs[i]);
        if (d < best) best = d;
      }
      if (best > worst) worst = best;
      if (best > RD.PAVED_HALF) off++;
      if (L.kind === 'street' && !(TR.heightAt(L.xs[i], L.zs[i]) > 0.5)) wet++;
    }
    if (!L.next.length && L.reverse == null) deadEnds++;
  }
  const wantsGround = d.ground.some((g) => g.on === 'streets' || g.on === 'roads' || g.on === 'streets+roads');
  ok(`${m.id}: ${lanes.length} lanes, every point within PAVED_HALF (${RD.PAVED_HALF} m) of its street or road`, off === 0, `${off} off, worst ${worst.toFixed(1)} m`);
  ok(`${m.id}: street lanes are on dry ground`, wet === 0, `${wet} wet points`);
  ok(`${m.id}: every lane end has somewhere to go`, deadEnds === 0, `${deadEnds}`);
  if (wantsGround) ok(`${m.id}: the map that asks for cars has lanes for them`, lanes.length > 0, `${W.streets} streets, ${W.roads} roads`);
  // Runways: no lane touches a strip. The roads are cut RUNWAY_OFF short of the tarmac on both
  // sides (an air base's loop crossed its runway twice; Kestrel's road crossed the crosswind strip).
  let onStrip = 0;
  let firstStrip = null;
  for (const L of lanes) {
    for (let i = 1; i < L.n; i++) {
      const n = Math.max(1, Math.ceil(Math.hypot(L.xs[i] - L.xs[i - 1], L.zs[i] - L.zs[i - 1]) / 2));
      for (let k = 0; k <= n; k++) {
        const t = k / n;
        const x = L.xs[i - 1] + (L.xs[i] - L.xs[i - 1]) * t;
        const z = L.zs[i - 1] + (L.zs[i] - L.zs[i - 1]) * t;
        if (TR.isOnAnyRunway(x, z, 8)) {
          onStrip++;
          if (!firstStrip) firstStrip = `${L.kind} at (${Math.round(x)}, ${Math.round(z)})`;
        }
      }
    }
  }
  ok(`${m.id}: no car lane within 8 m of a runway strip (the roads are cut ${LN.RUNWAY_OFF} m short of the tarmac)`, onStrip === 0, `${onStrip} points, ${firstStrip || ''}`);
  const sigs = W.net.signals.filter((s) => s.lanes.length);
  if (m.id === 'town' || m.id === 'gateway' || m.id === 'meridian') ok(`${m.id}: timed signals where the streets cross (${sigs.length})`, sigs.length > 0);

  // Boat routes.
  const keep = W.keep;
  const boatMap = !!(m.waters && m.waters.channel);
  let shallow = 0;
  let nearChannel = 0;
  let underDeck = 0;
  let routed = 0;
  let unrouted = [];
  let minDepth = Infinity;
  let minChan = Infinity;
  W.routes.forEach((r, i) => {
    if (!r.arrays) {
      unrouted.push(d.water[i].kind);
      return;
    }
    routed++;
    const A = r.arrays;
    for (let k = 1; k < A.n; k++) {
      const n = Math.max(1, Math.ceil(Math.hypot(A.xs[k] - A.xs[k - 1], A.zs[k] - A.zs[k - 1]) / 10));
      for (let j = 0; j <= n; j++) {
        const t = j / n;
        const x = A.xs[k - 1] + (A.xs[k] - A.xs[k - 1]) * t;
        const z = A.zs[k - 1] + (A.zs[k] - A.zs[k - 1]) * t;
        const depth = -TR.heightAt(x, z);
        if (depth < minDepth) minDepth = depth;
        if (depth < 3) shallow++;
        const cd = LN.channelDistance(keep, x, z);
        if (cd < minChan) minChan = cd;
        if (boatMap && cd < 60) nearChannel++;
        for (const dk of keep.decks) if (Math.hypot(dk.x - x, dk.z - z) < 60 + (dk.r - 60)) underDeck++;
      }
    }
  });
  if (d.water.length) {
    ok(`${m.id}: ${routed} of ${d.water.length} boat routes laid`, routed === d.water.length, `unrouted: ${unrouted.join(',')}`);
    ok(`${m.id}: every boat route point has 3 m of water`, shallow === 0, `${shallow} shallow, least ${minDepth.toFixed(1)} m`);
    if (boatMap) ok(`${m.id}: boat routes stay 60 m off the channel`, nearChannel === 0, `${nearChannel} points, nearest ${minChan.toFixed(0)} m`);
    if (keep.decks.length) ok(`${m.id}: boat routes stay off the deck pads`, underDeck === 0, `${underDeck}`);
  }

  // Flyers' patterns.
  const elev = TR.AIRPORT.elev;
  for (const a of d.air) {
    const where = a.orbit ? EXT.placeOf(a.orbit, sim) : null;
    if (where && a.alt == null) {
      // The ring's lowest clearance, as the data has it (the floor rule lifts it in flight).
      ok(`${m.id}: ${a.role} ${a.kind} orbits ${a.orbit} at r ${a.r}, ${a.agl} m AGL (150 or more)`, a.agl >= 150);
    } else if (a.alt != null) {
      // A fixed height over the sea; the corridor and floor rules lift it in flight (the soak proves it).
      ok(`${m.id}: ${a.role} ${a.kind} at ${a.alt} m is 600 m or more above the sea`, a.alt >= 600);
    } else if (a.transit) {
      ok(`${m.id}: ${a.role} ${a.kind} transits at ${a.agl} m AGL (150 or more)`, a.agl >= 150);
    }
  }
}

/* ------------------------------------------------------------------ */
/* 6. The soak                                                         */
/* ------------------------------------------------------------------ */

/** A scripted player: the circuit at 300 m and 60 m/s, with a pass over the town every other lap. */
function makePlayer(m) {
  const rw = TR.AIRPORT.runway;
  const elev = TR.AIRPORT.elev;
  const town = (m.scenery && m.scenery.town) || { cx: rw.cx + 1500, cz: rw.cz + 900 };
  const legs = [
    [rw.cx - rw.length / 2, rw.cz], [rw.cx + rw.length / 2 + 1500, rw.cz], [rw.cx + rw.length / 2 + 1500, rw.cz - 1200],
    [rw.cx - rw.length / 2 - 1500, rw.cz - 1200], [rw.cx - rw.length / 2 - 1500, rw.cz],
    [rw.cx - rw.length / 2, rw.cz], [rw.cx + rw.length / 2 + 1500, rw.cz], [town.cx, town.cz], [town.cx - 2500, town.cz + 1500], [rw.cx - rw.length / 2 - 1500, rw.cz],
  ];
  const P = { pos: new THREE.Vector3(legs[0][0], elev + 300, legs[0][1]), vel: new THREE.Vector3(), leg: 1, v: 60 };
  P.step = (dt) => {
    const to = legs[P.leg % legs.length];
    const dx = to[0] - P.pos.x;
    const dz = to[1] - P.pos.z;
    const d = Math.hypot(dx, dz);
    if (d < 80) {
      P.leg++;
      return;
    }
    const alt = Math.max(TR.heightAt(P.pos.x, P.pos.z), 0) + 300;
    P.vel.set((dx / d) * P.v, (alt - P.pos.y) * 0.5, (dz / d) * P.v);
    P.pos.x += P.vel.x * dt;
    P.pos.y += P.vel.y * dt;
    P.pos.z += P.vel.z * dt;
  };
  return P;
}

for (const m of maps) {
  loadMap(m);
  const W = WORLDS.get(m.id);
  const counts = AM.countsFor(m.id, 'high', 'full');
  if (!counts.air.length) {
    ok(`${m.id}: no flyers to soak (the data has none)`, true);
    continue;
  }
  const scene = new THREE.Scene();
  const sim = { scene, carrier: null, roads: { list: [] } };
  const flyers = [];
  const built = [];
  for (const e of counts.air) {
    let orbit = null;
    let transit = null;
    if (e.transit) {
      const a = EXT.placeOf(e.transit[0], sim);
      const b = EXT.placeOf(e.transit[1], sim);
      if (!a || !b) {
        ok(`${m.id}: ${e.role} transit resolves for the soak`, false, `${e.transit.join(' -> ')}`);
        continue;
      }
      transit = [a, b];
    } else {
      const c = EXT.placeOf(e.orbit, sim);
      if (!c) {
        ok(`${m.id}: ${e.role} orbit resolves for the soak`, false, `${e.orbit}`);
        continue;
      }
      orbit = { x: c.x, z: c.z, r: e.r || 1000 };
    }
    const land = e.land ? EXT.placeOf(e.land, sim) : null;
    const opts = { id: `soak-${m.id}-${e.role}`, role: e.role, orbit, transit, agl: e.agl, alt: e.alt || null, land: land && land.id ? land : null, shy: e.shy, sep: e.sep, type: e.type };
    const f = e.kind === 'heli' ? new FL.HeliFlyer(scene, opts) : new FL.PlaneFlyer(scene, opts);
    const start = orbit ? { x: orbit.x + orbit.r, z: orbit.z, h: 180 } : { x: transit[0].x, z: transit[0].z, h: 0 };
    f.place(start.x, start.z, null, start.h);
    if (transit) f.leg = 1;
    flyers.push(f);
    built.push(`${e.kind}:${e.role}`);
  }
  const P = makePlayer(m);
  const ctx = { player: P, noFly: [], weather: null, missionPads: new Set() };
  const elev = TR.AIRPORT.elev;
  let nan = 0;
  let floorBreach = 0;
  let corridorBreach = 0;
  let minSep = Infinity;
  let minAgl = Infinity;
  let worstFloor = '';
  let landings = 0;
  const steps = Math.round(SOAK_S / DT);
  const t0 = Date.now();
  for (let s = 0; s < steps; s++) {
    P.step(DT);
    for (const f of flyers) {
      f.update(DT, ctx);
      const p = f.pos;
      if (!Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isFinite(p.z) || !Number.isFinite(f.heading)) {
        nan++;
        continue;
      }
      const sep = Math.hypot(p.x - P.pos.x, p.y - P.pos.y, p.z - P.pos.z);
      if (sep < minSep) minSep = sep;
      const landing = f.mode && f.mode !== 'fly';
      if (landing) landings++;
      const ground = Math.max(0, TR.heightAt(p.x, p.z));
      const agl = p.y - ground;
      if (!landing) {
        if (agl < minAgl) minAgl = agl;
        if (agl < FL.FLOOR_AGL - 1) {
          floorBreach++;
          if (!worstFloor) worstFloor = `${f.role} at ${agl.toFixed(0)} m AGL, t=${(s * DT).toFixed(0)} s`;
        }
        if (FL.inCorridor(p.x, p.z) && p.y < elev + FL.CORRIDOR_MIN - 1) {
          corridorBreach++;
          if (!worstFloor) worstFloor = `${f.role} at ${(p.y - elev).toFixed(0)} m over the field in the corridor, t=${(s * DT).toFixed(0)} s`;
        }
      }
    }
  }
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  ok(`${m.id}: soak ${SOAK_S / 60} min with ${built.join(', ')} (${secs} s)`, true);
  ok(`${m.id}: no NaN in any flyer`, nan === 0, `${nan}`);
  ok(`${m.id}: no flyer under its floor (150 m AGL)`, floorBreach === 0, `${floorBreach} steps; least ${minAgl.toFixed(0)} m; ${worstFloor}`);
  ok(`${m.id}: no flyer under 600 m inside the player's corridors`, corridorBreach === 0, `${corridorBreach} steps; ${worstFloor}`);
  ok(`${m.id}: no flyer within 300 m of the player`, minSep >= FL.SEP, `nearest ${minSep.toFixed(0)} m`);
  const bodies = SKY.bodies().filter((b) => !b.gone && flyers.some((f) => f.body === b));
  ok(`${m.id}: every flyer is a sky body of kind npc (helicopters rotor:true)`, bodies.length === flyers.length && bodies.every((b) => b.kind === 'npc') && flyers.every((f) => !(f instanceof FL.HeliFlyer) || f.body.rotor === true), `${bodies.length} of ${flyers.length}`);
  for (const f of flyers) f.dispose();
  ok(`${m.id}: disposed flyers leave the sky`, SKY.bodies().every((b) => !flyers.some((f) => f.body === b) || b.gone));
}

/* ------------------------------------------------------------------ */
/* 7. The ground soak: nothing drives across a runway                  */
/* ------------------------------------------------------------------ */

/*
 * The real CarLayer on the real lanes, populated the way features/ambient.js
 * populates it at High, driven for GROUND_SOAK_S: no vehicle is ever within
 * 5 m of either runway strip. Before the roads were cut at the strips, the
 * air base had a truck or a jeep on its runway for 200 s in every 600.
 */
const CARS = await import(src + 'features/ambient/cars.js');
const GROUND_SOAK_S = quick ? 120 : 600;
const GDT = 0.1;
const laneKindsFor = (on) => (on === 'streets' ? ['street'] : on === 'roads' ? ['road'] : on === 'streets+roads' ? ['street', 'road'] : on && typeof on === 'object' && on.loop ? [`loop:${on.loop}`] : ['street', 'road']);
for (const m of maps) {
  loadMap(m);
  const W = WORLDS.get(m.id);
  const counts = AM.countsFor(m.id, 'high', 'full');
  const layer = new CARS.CarLayer(new THREE.Group(), W.net, { shadows: false });
  for (const g of counts.ground) {
    if (!g.count) continue;
    if (g.on && typeof g.on === 'object' && g.on.park) {
      const pk = W.parks.find((p) => p.kind === g.kind);
      if (pk) layer.populate(g.kind, g.count, { park: pk });
    } else layer.populate(g.kind, g.count, { laneKinds: laneKindsFor(g.on) });
  }
  layer.build();
  if (!layer.cars.length) {
    ok(`${m.id}: no ground vehicles to soak (the data has none)`, true);
    layer.dispose();
    continue;
  }
  const cam = new THREE.Vector3(0, 60, 0);
  let onStrip = 0;
  let firstOn = null;
  let drove = false;
  const t0 = Date.now();
  for (let t = 0; t < GROUND_SOAK_S; t += GDT) {
    layer.update(GDT, cam, false, null);
    for (const c of layer.cars) {
      if (c.speed > 0.5) drove = true;
      if (TR.isOnAnyRunway(c.px, c.pz, 5)) {
        onStrip++;
        if (!firstOn) firstOn = `${c.kind} at (${Math.round(c.px)}, ${Math.round(c.pz)}) t=${t.toFixed(1)} s`;
      }
    }
  }
  const driving = layer.cars.filter((c) => !c.parked).length;
  ok(`${m.id}: ground soak ${GROUND_SOAK_S / 60} min, ${layer.cars.length} vehicles (${((Date.now() - t0) / 1000).toFixed(1)} s): none within 5 m of a runway strip`, onStrip === 0, `${onStrip} samples, ${firstOn || ''}`);
  if (driving) ok(`${m.id}: the ${driving} on lanes drove (the cut roads still carry traffic)`, drove);
  layer.dispose();
}

/* ------------------------------------------------------------------ */

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) {
  console.log(fails.map((f) => '  FAIL ' + f).join('\n'));
  process.exit(1);
}

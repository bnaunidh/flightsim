/**
 * Everybody comes from somewhere and goes somewhere (the owner, Nov 5: "why do
 * people magically appear from outside the airport? and head into. wall"),
 * on EVERY map, in node:
 *
 *   node tests/features/crowd-doors.mjs
 *
 *   - every route of a person who comes and goes starts and ends at a door of
 *     the terminal or in an aeroplane's cabin, or (a bus, a car) in a vehicle
 *     at its stop; no route just begins on the concrete;
 *   - no point of anybody's route is inside a wall, a lobby's side, a canopy
 *     column or a hangar;
 *   - nobody is ever seen to pop: run for two minutes, a person appears and
 *     disappears only while wholly dark (a lobby, a cabin door), and only
 *     inside one.
 */
global.document = {
  createElement: () => ({
    getContext: () => new Proxy({}, { get: () => () => ({ addColorStop() {}, data: new Uint8ClampedArray(4) }) }),
    width: 0, height: 0, style: {},
  }),
  body: { appendChild() {} },
  head: { appendChild() {} },
};
globalThis.window = globalThis.window || { addEventListener() {}, devicePixelRatio: 1 };
const warn = console.warn;
console.warn = (...a) => (String(a[0]).includes('real vehicles') ? null : warn(...a));

const SRC = new URL('../../src/', import.meta.url).href;
const THREE = await import(SRC + 'vendor/three.module.js');
const TER = await import(SRC + 'world/terrain.js');
const APRON = await import(SRC + 'world/apron.js');
const MAPS = await import(SRC + 'world/maps.js');
const LAY = await import(SRC + 'features/life/doors.js');
const P = await import(SRC + 'features/life/plan.js');
const C = await import(SRC + 'features/life/crowd.js');
const { Route, VanFleet } = await import(SRC + 'features/life/vans.js');
const SIDE = await import(SRC + 'features/life/landside-plan.js');
const { makeRandom } = await import(SRC + 'core/noise.js');

let failed = 0;
let passed = 0;
function ok(name, pass, detail = '') {
  if (pass) passed++;
  else failed++;
  if (!pass || process.env.VERBOSE) console.log(`${pass ? 'ok  ' : 'FAIL'} ${name}${detail !== '' ? ` — ${detail}` : ''}`);
}

/** Where may a route end? `kind` of the place, or null: nowhere real. */
function placeAt(q, doors, parked, stops) {
  for (const d of doors) if (Math.hypot(d.in.x - q.x, d.in.z - q.z) < 1.2) return 'door';
  for (const s of stops) if (Math.hypot(s.x - q.x, s.z - q.z) < (s.r || 2)) return 'vehicle';
  for (const p of parked) {
    const tg = p.tg;
    if (!tg || !tg.info) continue;
    const dx = q.x - tg.ox;
    const dz = q.z - tg.oz;
    const lx = dx * tg.rx + dz * tg.rz;
    const lz = -(dx * tg.fx + dz * tg.fz);
    if (Math.abs(lx) < tg.info.hw + 0.1 && lz > tg.info.noseZ - 1 && lz < tg.info.tailZ + 1 && (q.y || 0) > 1) return 'cabin';
  }
  return null;
}

function inside(q, r, m = 0) {
  return q.x > r.x0 + m && q.x < r.x1 - m && q.z > r.z0 + m && q.z < r.z1 - m;
}

const ids = MAPS.MAPS.map((m) => m.id);
let routes = 0;
let points = 0;
for (const id of ids) {
  let ap;
  try {
    TER.applyMap(id);
    APRON.refreshApronElevation();
    ap = new APRON.Apron(new THREE.Scene(), 'high');
  } catch (e) {
    ok(`${id}: the apron builds`, false, e.message);
    continue;
  }
  const lay = ap.lay;
  if (!lay || !lay.apron) continue;
  const doors = LAY.terminalDoors(lay);
  // The road: a car park is on it or it is not there; the kerb road clears the building and the airside.
  const road = SIDE.forecourtRoad(lay);
  if (lay.terminal && !lay.military && lay.shape !== 'strip') {
    ok(`${id}: the terminal has its forecourt road`, !!road);
    if (road) {
      const hits = [];
      const made = [lay.terminal.rect, lay.apron.rect, ...(lay.hangars || []).map((h) => h.rect), lay.tower && lay.tower.rect, lay.fuel && lay.fuel.rect, lay.fire && lay.fire.rect, ...(lay.pavement || []).filter((p) => p.kind !== 'apron')].filter(Boolean);
      for (const q of road.ring) for (const m of made) if (inside(q, m, -road.hw)) hits.push(`${q.x | 0},${q.z | 0}`);
      ok(`${id}: the forecourt road crosses no building, taxiway or runway`, hits.length === 0, [...new Set(hits)].slice(0, 3).join(' '));
      // The kerb lane runs along the kerb: straight, the right distance out, and every stop is on it.
      {
        const F = lay.frame;
        const T = lay.terminal;
        const wOf = (q) => (q.z - F.cz) * F.side - T.back;
        const uOf = (q) => q.x - F.cx;
        // Along the segments: the straights have no points between their ends.
        const along = (loop) => {
          const out = [];
          loop.forEach((a, i) => {
            const b = loop[(i + 1) % loop.length];
            for (let t = 0; t <= 1; t += 0.05) out.push({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t });
          });
          return out;
        };
        const nearL = along(road.lane).filter((q) => Math.abs(uOf(q) - road.mid) < road.L - 12 && wOf(q) < road.near + 2);
        const offKerb = nearL.filter((q) => Math.abs(wOf(q) - 10.4) > 0.05);
        ok(`${id}: the kerb lane runs straight along the kerb`, nearL.length >= 2 && offKerb.length === 0, `${nearL.length} points, ${offKerb.length} off it`);
        const nearR = along(road.ring).filter((q) => Math.abs(uOf(q) - road.mid) < road.L - 12 && wOf(q) < road.near + 2);
        ok(`${id}: and the road's edge meets the kerb`, nearR.length >= 2 && nearR.every((q) => Math.abs(wOf(q) - road.hw - 8.6) < 0.05), `${nearR.length} points`);
        const route = new Route(road.lane, true);
        const q = { x: 0, y: 0, z: 0, yaw: 0 };
        const off = road.stops.filter((s) => {
          route.sample(s.d, q);
          return Math.hypot(q.x - s.x, q.z - s.z) > 0.5;
        });
        ok(`${id}: every stop is on the lane, where the vehicle really stops`, off.length === 0, off.map((s) => s.kind).join(' '));
      }
      if (lay.carPark) {
        const c = lay.carPark.rect;
        // To the road's segments, not its points: the long straights have none between their ends.
        let toRoad = Infinity;
        road.ring.forEach((a, i) => {
          const b = road.ring[(i + 1) % road.ring.length];
          for (let t = 0; t <= 1; t += 0.02) {
            const x = a.x + (b.x - a.x) * t;
            const z = a.z + (b.z - a.z) * t;
            toRoad = Math.min(toRoad, Math.max(c.x0 - x, x - c.x1, c.z0 - z, z - c.z1, 0));
          }
        });
        ok(`${id}: the car park joins the road`, road.inRing && toRoad < 20, `${toRoad.toFixed(1)} m, in the loop ${road.inRing}`);
      }
    }
  }
  for (const tier of ['low', 'high']) {
    const crews = ap.crews.filter((c) => c.tg && !(c.opts && c.opts.spare));
    const r = P.planLife({ lay, parked: ap.parked, crews, bridges: ap.bridges, tier, rnd: makeRandom(9) });
    const solid = [];
    if (lay.terminal && lay.terminal.rect) solid.push(lay.terminal.rect);
    for (const h of lay.hangars || []) if (h && h.rect) solid.push(h.rect);
    const parts = P.terminalSolids(lay);
    const bad = [];
    const nowhere = [];
    for (const w of r.walkers) {
      if (w.mode === 'cycle') {
        routes++;
        for (const q of [w.path[0], w.path[w.path.length - 1]]) {
          if (!placeAt(q, doors, ap.parked, r.stops || [])) nowhere.push(`${w.role} at ${q.x | 0},${q.z | 0}`);
        }
        if (!w.fade || !(w.fade[0] > 0 && w.fade[1] > 0)) nowhere.push(`${w.role} does not fade`);
      }
      // On a bench is on a bench.
      if (w.seat) continue;
      const pts = w.path;
      const n = w.mode === 'loop' ? pts.length : Math.max(1, pts.length - 1);
      for (let i = 0; i < n; i++) {
        const a = pts[i];
        const b = pts[(i + 1) % pts.length];
        const L = Math.hypot(a.x - b.x, a.z - b.z);
        const steps = Math.max(1, Math.ceil(L / 0.5));
        for (let k = 0; k <= steps; k++) {
          const t = k / steps;
          const q = { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t };
          points++;
          for (const s of solid) if (inside(q, s, -0.15)) bad.push(`${w.role} in a building at ${q.x | 0},${q.z | 0}`);
          for (const s of parts) {
            if (s.r ? Math.hypot(q.x - s.x, q.z - s.z) < s.r + 0.15 : inside(q, s)) bad.push(`${w.role} in a ${s.r ? 'column' : 'lobby wall'} at ${q.x | 0},${q.z | 0}`);
          }
        }
      }
    }
    ok(`${id} ${tier}: every coming and going starts and ends at a door or a cabin`, nowhere.length === 0, [...new Set(nowhere)].slice(0, 4).join('; '));
    ok(`${id} ${tier}: no point of any route is in a wall`, bad.length === 0, [...new Set(bad)].slice(0, 4).join('; '));

    // Nobody pops: a walker in sight with any light on it never appears or vanishes.
    const elev = TER.AIRPORT.elev;
    const rnd = makeRandom(4);
    const walkers = C.makeWalkers(r.walkers, elev, rnd, Route);
    const fleet = (r.kerb || []).length ? new VanFleet(r.kerb, elev, { stopCount: r.stops.length, low: true }) : null;
    const life = new C.ApronLife({ walkers, vans: fleet, apron: null, obs: r.obs, elev });
    const was = walkers.map((w) => ({ hidden: w.hidden, dim: w.dim }));
    const startD = fleet ? fleet.list.map((v) => v.d) : [];
    let pops = 0;
    let seen = 0;
    let worst = '';
    for (let f = 0; f < 2400; f++) {
      life.step(0.05, [], { x: walkers.length ? walkers[0].x : 0, z: walkers.length ? walkers[0].z : 0 });
      for (let i = 0; i < walkers.length; i++) {
        const w = walkers[i];
        const v = was[i];
        if (w.hidden !== v.hidden) {
          seen++;
          const dim = Math.min(w.dim, v.dim);
          // A dim of 0.15 is about a tenth of the light, at the back of a black lobby.
          if (dim > 0.15) {
            pops++;
            worst = `${w.role} ${w.hidden ? 'vanished' : 'appeared'} at dim ${dim.toFixed(2)}`;
          }
        }
        v.hidden = w.hidden;
        v.dim = w.dim;
      }
    }
    ok(`${id} ${tier}: two minutes, and nobody popped in or out in the light`, pops === 0, `${seen} comings and goings; ${worst}`);
    // Nobody who is waiting for a car waits for ever, and nobody stands in the road or walks through a car.
    const gated = walkers.filter((w) => w.gate != null);
    if (fleet && gated.length) {
      const stopped = fleet.list.every((v) => v.next > 0 || v.dwell > 0);
      ok(`${id} ${tier}: every vehicle on the forecourt has stopped at the kerb`, stopped, fleet.list.map((v) => `${v.kind}:${v.next}`).join(' '));
      // ...and gone on: a vehicle that never leaves its stop has stopped too, and it blocks the road behind it.
      const crawled = fleet.list.filter((v, i) => v.d - startD[i] < 150).map((v, i) => `${v.kind} ${Math.round(v.d - startD[fleet.list.indexOf(v)])} m`);
      ok(`${id} ${tier}: and every one drives on round the loop (150 m in two minutes)`, crawled.length === 0, crawled.slice(0, 4).join(', '));
      const used = gated.some((w) => w.d > 0 || w.wait > 0);
      ok(`${id} ${tier}: people really do get in and out of them`, used, `${gated.length} people`);
    }
    if (fleet) fleet.dispose();
  }
}
console.log(`${routes} routes, ${points} points on ${ids.length} maps`);
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

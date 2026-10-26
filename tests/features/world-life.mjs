/**
 * World life, planned (features/life/plan.js), checked in node against the
 * real airports:
 *
 *   node tests/features/world-life.mjs
 *
 *   - every map shape (regional, hub, compact, strip, the air base) gets
 *     people where its kind of airport has them: crews and passengers at a
 *     gate, a kerb at a terminal, spectators at a flying club, guards and
 *     crew chiefs on the base;
 *   - no person and no vehicle is ever planned onto a runway or the
 *     taxiway; nobody's route goes through another stand's aeroplane or
 *     its vehicles; the vehicles' loop clears everything parked by its
 *     half-width all the way round;
 *   - the passengers come down the stair truck's own steps (the door at
 *     the sill, the bed at 1.25 m), and walk to the terminal's face;
 *   - the tiers cap the people (Low the fewest) and the night thins the
 *     passengers and the kerb but not the crews;
 *   - a mission's share is honoured, and Low's apron (no parked airliners)
 *     plans no crews and no passengers at all.
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
const P = await import(SRC + 'features/life/plan.js');
const { makeRandom } = await import(SRC + 'core/noise.js');

let failed = 0;
let passed = 0;
function ok(name, pass, detail = '') {
  if (pass) passed++;
  else failed++;
  console.log(`${pass ? 'ok  ' : 'FAIL'} ${name}${detail !== '' ? ` — ${detail}` : ''}`);
}

const built = new Map();
function apronFor(mapId, q = 'high') {
  const key = `${mapId}|${q}`;
  if (built.has(key)) return built.get(key);
  TER.applyMap(mapId);
  APRON.refreshApronElevation();
  const ap = new APRON.Apron(new THREE.Scene(), q);
  built.set(key, ap);
  return ap;
}
const plan = (ap, opts = {}) =>
  P.planLife({ lay: ap.lay, parked: ap.parked, crews: ap.crews.filter((c) => c.tg && !(c.opts && c.opts.spare)), bridges: ap.bridges, entrances: ap.entrances || null, rnd: makeRandom(5), ...opts });
const roles = (r) => {
  const o = {};
  for (const w of r.walkers) o[w.role] = (o[w.role] || 0) + 1;
  return o;
};

const MAPS = [
  ['kestrel', 'regional'],
  ['gateway', 'hub'],
  ['sennen', 'compact'],
  ['fjord', 'regional on rising ground'],
  ['town', 'strip'],
  ['airbase', 'air base'],
];

for (const [id, what] of MAPS) {
  const ap = apronFor(id);
  const lay = ap.lay;
  const r = plan(ap, { tier: 'high' });
  const ro = roles(r);
  const tx = lay.taxiway && lay.taxiway.rect;
  const bad = [];
  const pt = (q, w) => {
    if (TER.isOnAnyRunway(q.x, q.z, 8)) bad.push(`${w} on a runway`);
    if (tx && q.x > tx.x0 - 2 && q.x < tx.x1 + 2 && q.z > tx.z0 - 2 && q.z < tx.z1 + 2) bad.push(`${w} on the taxiway`);
  };
  for (const w of r.walkers) {
    for (let i = 0; i < w.path.length; i++) {
      const a = w.path[i];
      const b = w.path[Math.min(i + 1, w.path.length - 1)];
      for (let t = 0; t <= 1; t += 0.1) pt({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t }, w.role);
    }
  }
  for (const v of r.vans) {
    for (let i = 0; i < v.path.length; i++) {
      const a = v.path[i];
      const b = v.path[(i + 1) % v.path.length];
      for (let t = 0; t <= 1; t += 0.02) pt({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t }, v.kind);
    }
  }
  ok(`${id} (${what}): nobody and no vehicle on a runway or the taxiway`, bad.length === 0, [...new Set(bad)].join(', '));

  if (lay.military) {
    ok(`${id}: guards and a crew chief at each parked jet, no passengers, no kerb`, (ro.guard || 0) >= 2 && (ro.chief || 0) >= 1 && !ro.pax && !ro.kerb, JSON.stringify(ro));
  } else if (lay.shape === 'strip') {
    ok(`${id}: a flying club — people on the veranda, no kerb, no service vehicles`, (ro.spectator || 0) >= 1 && !ro.kerb && r.vans.length === 0, JSON.stringify(ro));
  } else {
    ok(`${id}: crews, passengers and a kerb`, (ro.dispatcher || 0) >= 1 && (ro.pax || 0) >= 1 && (ro.kerb || 0) >= 4, JSON.stringify(ro) + ' ' + r.why.join(' / '));
    // A shallow apron filled to its front edge (the compact ones) has no room for the return leg:
    // then one vehicle runs up and down the airside road, never two to meet head-on.
    const noLoop = r.why.some((w) => /no clear loop/.test(w));
    ok(`${id}: service vehicles on a loop round the apron (High: four)${noLoop ? ' — or, with no room for a loop, one on the airside road' : ''}`,
      noLoop ? r.vans.length === 1 && r.vans[0].mode === 'pingpong' && lay.shape === 'compact' : r.vans.length === 4 && r.vans.every((v) => v.mode === 'loop'),
      r.vans.map((v) => v.kind).join(',') + ' ' + r.why.join(' / '));
    // The loop clears everything parked, every metre of it.
    const obs = P.apronObstacles(lay, ap.parked, ap.crews.filter((c) => c.tg && !(c.opts && c.opts.spare)), ap.bridges);
    ok(`${id}: the vehicles' route clears the parked aeroplanes, their vehicles and the bridges by 1.5 m`, r.vans.length > 0 && P.routeClear(obs, r.vans[0].path, 1.5, r.vans[0].mode === 'loop'));
    // Passengers: down the stair truck's own steps, to the terminal face.
    const pax = r.walkers.filter((w) => w.role === 'pax');
    const route = pax.length ? (pax[0].board ? pax[0].path.slice().reverse() : pax[0].path) : null;
    ok(`${id}: passengers use the stairs — the door at the sill, the bed at 1.25 m, then the ground`, !!route && route[0].y > 1.5 && Math.abs(route[2].y - 1.25) < 1e-6 && route[3].y === 0);
    const T = lay.terminal;
    const end = route ? route[route.length - 1] : null;
    const wEnd = end ? (end.z - lay.frame.cz) * lay.frame.side : 0;
    ok(`${id}: and walk to the terminal's face (within a metre of it)`, !!end && Math.abs(wEnd - (T.front - 0.6)) < 1, end ? `${wEnd.toFixed(1)} vs ${T.front}` : 'none');
    // Others' things: a passenger's walk from the stair foot never crosses another stand's aeroplane.
    const others = (w) => {
      const own = ap.parked.find((p) => p.stand && (p.stand.id || p.stand.number) === w.zone);
      return { circles: obs.circles.filter((c) => !own || c.tg !== own.tg), rects: [] };
    };
    const crossing = pax.filter((w) => !P.routeClear(others(w), (w.board ? w.path.slice().reverse() : w.path).slice(3), 0.4));
    ok(`${id}: no passenger walk crosses another stand's aeroplane or vehicles`, crossing.length === 0, crossing.length);
    // ...and stays inside its own stand's width, whether the stand beside it is empty or not.
    const wide = pax.filter((w) => {
      const own = ap.parked.find((p) => p.stand && (p.stand.id || p.stand.number) === w.zone);
      if (!own) return true;
      const tg = own.tg;
      return w.path.slice(0, -1).some((q) => Math.abs((q.x - tg.ox) * tg.rx + (q.z - tg.oz) * tg.rz) > own.stand.pitch / 2);
    });
    ok(`${id}: every passenger walk stays inside its own stand's width`, wide.length === 0, wide.length);
    // The kerb walkers stand on the ground they are given.
    const kerb = r.walkers.filter((w) => w.role === 'kerb');
    ok(`${id}: the kerb is behind the terminal (landside), along its canopy`, kerb.length > 0 && kerb.every((w) => w.path.every((q) => (q.z - lay.frame.cz) * lay.frame.side > T.back - 0.1)));
  }

  // Tiers and the night.
  const low = plan(ap, { tier: 'low' });
  const ultra = plan(ap, { tier: 'ultra' });
  ok(`${id}: Low plans the fewest people, Ultra the most, each inside its cap`, low.walkers.length <= P.PEOPLE_CAP.low && ultra.walkers.length <= P.PEOPLE_CAP.ultra && low.walkers.length <= r.walkers.length && r.walkers.length <= ultra.walkers.length, `${low.walkers.length} / ${r.walkers.length} / ${ultra.walkers.length}`);
  if (!lay.military && lay.shape !== 'strip') {
    const night = roles(plan(ap, { tier: 'high', time: 'night' }));
    ok(`${id}: at night fewer passengers and a quieter kerb, the same crews`, (night.pax || 0) < (ro.pax || 0) && (night.kerb || 0) < (ro.kerb || 0) && night.dispatcher === ro.dispatcher, `${JSON.stringify(ro)} → ${JSON.stringify(night)}`);
    const mission = plan(ap, { tier: 'high', level: 0.5 });
    ok(`${id}: a mission's half share plans about half`, mission.walkers.length <= Math.ceil(r.walkers.length * 0.75) && mission.walkers.length > 0 && mission.vans.length <= 2, `${mission.walkers.length} of ${r.walkers.length}, ${mission.vans.length} vehicles`);
  }
}

// Low's apron parks no airliners, so it plans no crews and no passengers at all.
{
  const ap = apronFor('kestrel', 'low');
  const r = plan(ap, { tier: 'low' });
  const ro = roles(r);
  ok('kestrel on Low: no parked airliners, so no crews and no passengers — the kerb, and no extra vehicles', ap.parked.length === 0 && !ro.pax && !ro.dispatcher && (ro.kerb || 0) >= 1 && r.vans.length === 0, JSON.stringify(ro) + ` vans ${r.vans.length}`);
}

// The pure helpers.
{
  const obs = { circles: [{ x: 0, z: 0, r: 2 }], rects: [{ x0: 10, x1: 12, z0: -1, z1: 1 }] };
  ok('segmentClear: a segment through a circle is not clear; one beside it is', !P.segmentClear(obs, { x: -5, z: 0 }, { x: 5, z: 0 }, 0.5) && P.segmentClear(obs, { x: -5, z: 3 }, { x: 5, z: 3 }, 0.5));
  ok('segmentClear: a rectangle counts too', !P.segmentClear(obs, { x: 11, z: -5 }, { x: 11, z: 5 }, 0.5));
  ok('timeFactor: night a third-ish, sunset three quarters, rain less again', P.timeFactor('night') < 0.4 && P.timeFactor('sunset') === 0.75 && P.timeFactor('day', 'rainy') < 1);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

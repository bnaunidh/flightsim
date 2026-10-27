/**
 * The apron's people and vehicles keep out of each other (wave 18, owner at a
 * Gateway gate: "need to make sure npcs arent coliding o getting hit by
 * cars"), run in node for minutes of apron time:
 *
 *   node tests/features/apron-crowd.mjs            (MINUTES=4 by default)
 *
 * At five airports (the Gateway hub, Kestrel, Sennen's compact apron, Fjord on
 * rising ground, the air base) on Low, High and Ultra, with the ground crew called to two empty
 * gates in turn (the spare crew driving in along the airside road, through
 * the passengers' crossings), every 1/30 s:
 *
 *   - 0 walker–walker overlaps: no two people in sight closer than 2 x 0.3 m;
 *   - 0 walker–vehicle overlaps: nobody's 0.3 m inside the box of a moving
 *     vehicle (the apron loop's vans and the baggage train's carts, every
 *     crew's own baggage train, the spare crew arriving, the follow-me van) —
 *     nor of a parked crew vehicle, except the one a walker works at (the
 *     passengers' stair truck, the loader's belt loader, the fueller's bowser);
 *   - nobody gets stuck: every passenger load completes its walk, every van
 *     keeps lapping, no walker stands still for more than 60 s that is not
 *     meant to (an idle crew member, a pause at the end of a beat);
 *   - the vehicles stop for people (yields happen) and the people wait for
 *     the vehicles (waits happen), with the brake lights on while they do.
 *
 * A NAIVE run of the same scene — the route-following and the three-point
 * look-ahead of the code before this — is measured first, to show the
 * overlaps are real and the counters see them.
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
const VANS = await import(SRC + 'features/life/vans.js');
const C = await import(SRC + 'features/life/crowd.js');
const { FOOT } = await import(SRC + 'world/vehicle-footprints.js');
const { makeRandom } = await import(SRC + 'core/noise.js');

const MINUTES = Number(process.env.MINUTES || 4);
const DT = 1 / 30;
const R = C.WALKER_R;

let failed = 0;
let passed = 0;
function ok(name, pass, detail = '') {
  if (pass) passed++;
  else failed++;
  console.log(`${pass ? 'ok  ' : 'FAIL'} ${name}${detail !== '' ? ` — ${detail}` : ''}`);
}

/** The parked crews' vehicles as boxes: { kind, tg, m } (m a MoverSet record). */
function parkedBoxes(ap) {
  const set = new C.MoverSet();
  const out = [];
  for (const c of ap.crews) {
    if (!c.tg || !c.poses || (c.opts && c.opts.spare)) continue;
    for (const kind of ['tug', 'stairTruck', 'cateringTruck', 'fuelTruck', 'beltLoader', 'gpu']) {
      const q = c.poses[kind];
      if (!q || !c.v || c.v[kind] == null) continue;
      if (kind !== 'gpu' && kind !== 'tug' && kind !== 'fuelTruck' && !c.opts.full) continue;
      out.push({ kind, tg: c.tg, m: { ...set.add(kind, q.x, q.z, q.yaw, 0) } });
    }
  }
  return out;
}

function emptyStands(ap) {
  const busy = new Set(ap.parked.filter((p) => p.stand).map((p) => p.stand));
  return ap.lay.stands.filter((s) => !busy.has(s) && s.size !== 'light' && s.bridge);
}

/** One scene: an airport, a tier, a seed — naive (the old code's manners) or with the crowd. */
function run(mapId, tier, { naive = false, minutes = MINUTES } = {}) {
  TER.applyMap(mapId);
  APRON.refreshApronElevation();
  const ap = new APRON.Apron(new THREE.Scene(), tier);
  const elev = TER.AIRPORT.elev;
  const rnd = makeRandom(mapId.length * 131 + tier.length * 17);
  const plan = P.planLife({
    lay: ap.lay, parked: ap.parked, crews: ap.crews.filter((c) => c.tg && !(c.opts && c.opts.spare)), bridges: ap.bridges,
    entrances: ap.entrances || null, tier, rnd, level: 1,
  });
  const walkers = C.makeWalkers(plan.walkers, elev, rnd, VANS.Route);
  const vans = plan.vans.length ? new VANS.VanFleet(plan.vans, elev) : null;
  const life = new C.ApronLife({ walkers, vans, apron: naive ? null : ap, obs: plan.obs, elev });
  const parked = parkedBoxes(ap);
  const gates = emptyStands(ap);
  const info = APRON.estimateInfo('a320');
  const res = { cyclers: walkers.filter((w) => w.mode === 'cycle').length, walkers: walkers.length, vans: vans ? vans.list.length : 0, ww: 0, wv: 0, wp: 0, worstWW: 9, worstWV: 9, cycles: 0, stuck: [], vanProgress: [], yields: 0, waits: 0, braked: 0, frames: 0, gates: 0, examples: [] };
  const vanRun = vans ? vans.list.map(() => 0) : [];
  const vanLast = vans ? vans.list.map((v) => v.d) : [];
  const lastMove = walkers.map(() => 0);
  const lastPos = walkers.map((w) => ({ x: w.x, z: w.z }));
  const prevVisible = walkers.map((w) => !w.hidden);
  let aircraft = [];
  const frames = Math.round((minutes * 60) / DT);
  const check = new C.MoverSet();
  const s0 = { x: 0, y: 0, z: 0, yaw: 0 };
  // The camera at the first gate called (the far people are stepped less often).
  const cam = gates[0] ? { x: gates[0].x, z: gates[0].z } : { x: ap.lay.frame.cx, z: ap.lay.frame.cz };
  for (let f = 0; f < frames; f++) {
    const t = f * DT;
    // The ground crew called to an empty gate, then sent away and called to another.
    const g = t < 125 ? 0 : 1;
    if (gates[g] && (Math.abs(t - 5) < DT / 2 || Math.abs(t - 125) < DT / 2)) {
      const st = gates[g];
      if (g === 1) ap.dismissCrew();
      ap.callCrew(st.x, st.z, st.headingDeg, info, st);
      // The player's aeroplane on that stand: people keep clear of it.
      aircraft = [{ x: st.x, z: st.z, r: info.halfSpan + 7 }];
      res.gates++;
    }
    ap.update(DT, {});
    if (naive) {
      // The code before wave 18: routes followed blind, the vans' three-point look-ahead.
      for (const w of walkers) {
        if (w.mode === 'idle') continue;
        if (w.mode === 'pingpong') {
          if (w.wait > 0) w.wait -= DT;
          else {
            w.d += w.dir * w.speed * DT;
            if (w.d >= w.route.length || w.d <= 0) { w.d = Math.max(0, Math.min(w.route.length, w.d)); w.dir = -w.dir; w.wait = w.pause; }
          }
        } else if (w.mode === 'loop') w.d += w.speed * DT;
        else if (w.mode === 'cycle') {
          if (w.wait > 0) { w.wait -= DT; if (w.wait <= 0) w.d = w.d0; w.hidden = true; continue; }
          w.d += w.speed * DT;
          if (w.d > w.route.length) { w.wait = w.rest; w.hidden = true; continue; }
          w.hidden = w.d < 0;
          if (w.hidden) continue;
        }
        w.route.sample(w.d, s0);
        w.x = s0.x;
        w.z = s0.z;
      }
      if (vans) vans.step(DT, aircraft, walkers, false);
    } else {
      life.step(DT, aircraft, cam, false);
    }
    res.frames++;
    // Measure, against where everything is now.
    check.begin();
    if (vans) vans.moversInto(check);
    ap.moversInto(check);
    for (let i = 0; i < walkers.length; i++) {
      const w = walkers[i];
      if (w.hidden) continue;
      for (let j = i + 1; j < walkers.length; j++) {
        const o = walkers[j];
        if (o.hidden) continue;
        const d = Math.hypot(w.x - o.x, w.z - o.z);
        if (Math.abs((w.y || 0) - (o.y || 0)) > 1.2) continue; // one on the stairs above the other
        if (d < res.worstWW) res.worstWW = d;
        if (d < 2 * R) {
          res.ww++;
          if (res.examples.length < 4) res.examples.push(`t${t.toFixed(1)} ${w.role}/${o.role} ${d.toFixed(2)}m [${w.mode} d${w.d.toFixed(1)} dir${w.dir} mv${+w.moving} | ${o.mode} d${o.d.toFixed(1)} dir${o.dir} mv${+o.moving} same-route ${w.route === o.route}]`);
        }
      }
      for (let k = 0; k < check.n; k++) {
        const m = check.list[k];
        if (Math.abs(w.x - m.x) > m.R + 1 || Math.abs(w.z - m.z) > m.R + 1) continue;
        const d = C.boxDist(m, w.x, w.z);
        if (d < res.worstWV) res.worstWV = d;
        if (d < R) {
          res.wv++;
          if (res.examples.length < 8) res.examples.push(`t${t.toFixed(1)} ${w.role} in ${m.kind} ${d.toFixed(2)}m`);
        }
      }
      for (const q of parked) {
        if (q.tg === w.tg && w.skip && w.skip.includes(q.kind)) continue;
        if (Math.abs(w.x - q.m.x) > 8 || Math.abs(w.z - q.m.z) > 8) continue;
        if (C.boxDist(q.m, w.x, w.z) < R) {
          res.wp++;
          if (res.examples.length < 8) res.examples.push(`t${t.toFixed(1)} ${w.role} in parked ${q.kind}`);
        }
      }
      // Liveness.
      if (Math.hypot(w.x - lastPos[i].x, w.z - lastPos[i].z) > 0.05 || w.mode === 'idle' || w.held || (w.mode === 'pingpong' && w.wait > 0)) {
        lastMove[i] = t;
        lastPos[i].x = w.x;
        lastPos[i].z = w.z;
      } else if (t - lastMove[i] > 60 && !res.stuck.includes(i)) res.stuck.push(i);
    }
    for (let i = 0; i < walkers.length; i++) {
      const w = walkers[i];
      const vis = !w.hidden;
      if (w.mode === 'cycle' && prevVisible[i] && !vis && w.wait > 0) res.cycles++;
      prevVisible[i] = vis;
      if (!vis) lastMove[i] = t;
    }
    if (vans) vans.list.forEach((v, i) => {
      if (v.braking && v.yielding) res.braked++;
      vanRun[i] += Math.abs(v.d - vanLast[i]);
      vanLast[i] = v.d;
    });
  }
  if (vans) res.vanProgress = vanRun.map(Math.round);
  res.yields = (vans ? vans.stats.yields : 0);
  res.waits = life.stats.vehicleWaits;
  res.stats = life.stats;
  res.stuckRoles = res.stuck.map((i) => `${walkers[i].role}@${walkers[i].zone}`);
  return res;
}

/* ---- the old manners, for scale ---- */
let naiveTotal = 0;
for (const id of ['gateway', 'kestrel']) {
  const r = run(id, 'ultra', { naive: true, minutes: Math.min(MINUTES, 2) });
  naiveTotal += r.ww + r.wv;
  console.log(`     naive ${id}/ultra: ${r.walkers} people, ${r.vans} vans — ${r.ww} walker-walker and ${r.wv} walker-vehicle overlap-frames`);
}
ok('the counters see the old code\'s overlaps (people through people and through vehicles)', naiveTotal > 0, String(naiveTotal));

/* ---- with the crowd ---- */
const SCENES = [
  ['gateway', 'ultra'],
  ['gateway', 'high'],
  ['kestrel', 'ultra'],
  ['sennen', 'high'],
  ['fjord', 'ultra'],
  ['kestrel', 'low'],
  ['airbase', 'high'],
];
let anyYield = 0;
let anyWait = 0;
let anyBrake = 0;
for (const [id, tier] of SCENES) {
  const t0 = Date.now();
  const r = run(id, tier);
  const ms = Date.now() - t0;
  const what = `${id}/${tier}: ${r.walkers} people, ${r.vans} vans, ${r.gates} gate calls, ${MINUTES} min`;
  ok(`${what}: 0 walker–walker overlaps`, r.ww === 0, `${r.ww} frames, closest ${r.worstWW.toFixed(2)} m ${r.examples.filter((e) => /\//.test(e)).join('; ')}`);
  ok(`${what}: 0 walker–moving-vehicle overlaps`, r.wv === 0, `${r.wv} frames, closest ${r.worstWV.toFixed(2)} m ${r.examples.filter((e) => / in (?!parked)/.test(e)).join('; ')}`);
  ok(`${what}: 0 walkers inside a parked crew vehicle they do not work at`, r.wp === 0, `${r.wp} ${r.examples.filter((e) => /parked/.test(e)).join('; ')}`);
  ok(`${what}: nobody stuck over 60 s`, r.stuck.length === 0, r.stuckRoles.join(', '));
  if (r.cyclers) ok(`${what}: the passengers keep coming and going (${r.cycles} walks done)`, r.cycles > 0, String(r.cycles));
  if (r.vans) ok(`${what}: every van keeps driving its rounds`, r.vanProgress.every((d) => d > 150 * MINUTES), r.vanProgress.join(','));
  anyYield += r.yields;
  anyWait += r.waits;
  anyBrake += r.braked;
  console.log(`     ${id}/${tier}: ${ms} ms for ${r.frames} frames (${(ms / r.frames).toFixed(2)} ms/frame), yields ${r.yields}, waits ${r.waits}, pushes ${r.stats.pushes}, step-asides ${r.stats.stepAsides}, LOD-skipped ${r.stats.skipped}`);
}
ok('the vehicles stop for people, with the brake lights on', anyYield > 0 && anyBrake > 0, `${anyYield} yields, ${anyBrake} braking frames`);
ok('people wait at the edge for vehicles', anyWait > 0, String(anyWait));

/* ---- the pieces ---- */
{
  const M = new C.MoverSet();
  const m = M.add('bus', 10, 20, Math.PI / 2, 0);
  ok('boxDist: inside the bus is 0, beside it its distance off the side', C.boxDist(m, 10, 20) === 0 && Math.abs(C.boxDist(m, 10, 20 + FOOT.bus.hw + 1) - 1) < 1e-6);
  const g = new C.Grid(8);
  g.insert(0, 1, 1);
  g.insert(1, 50, 50);
  ok('Grid: finds who is near, not who is far', g.near(1.5, 1.2, 1) === 1 && g.out[0] === 0 && !g.any(20, 20, 3));
  const st = new C.Statics({ circles: [{ x: 0, z: 0, r: 2, kind: 'plane', tg: 'A' }], rects: [] });
  ok('Statics: an aeroplane is solid to everybody but its own crew', !st.clear({ tg: 'B' }, 1, 0) && st.clear({ tg: 'A', skip: [] }, 1, 0));
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

/**
 * Node checks for the ADVANCING FIRE FRONT (src/features/wildfire/front.js)
 * and the burn scar (grid.scorch). Run with plain node:
 *
 *   node tests/features/fire-front.mjs
 *
 * A front is a fire tuned as a chase, so the things that have to be true are
 * numbers: it runs at the speed it is given; water holds the stretch it lands
 * on and only that stretch, until it dries; rock stops it unless the gap is
 * one it may jump; it never pushes the grid past its share of the cap; and a
 * checkpoint's save() put back with restore() is the same front on a fresh
 * grid. The scar is spent ground that never relights.
 */

globalThis.document = {
  createElement: () => ({ getContext: () => new Proxy({}, { get: () => () => ({ addColorStop() {}, data: new Uint8ClampedArray(4) }) }), width: 0, height: 0, style: {} }),
  body: { appendChild() {} },
};

const root = new URL('../../src/', import.meta.url);
const imp = (p) => import(new URL(p, root).href);
const { FireGrid, FUEL, STATE, WET_SECONDS } = await imp('features/wildfire/grid.js');
const { FireFront } = await imp('features/wildfire/front.js');

let passed = 0;
let failed = 0;
function ok(name, pass, detail = '') {
  if (pass) passed++;
  else failed++;
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
}

/** Flat grass, with optional rock where `rock(x, z)`. */
function grid({ rock = () => false, cap = 900, spread = 0 } = {}) {
  const g = new FireGrid({ size: 200, cell: 20, maxBurning: cap, seed: 5 });
  g.sampler = { height: () => 10, classify: (x, z) => (rock(x, z) ? FUEL.NONE : FUEL.GRASS) };
  g.setWindow(0, 0);
  g.spreadMul = spread; // the front alone, unless a check asks for the spread too
  return g;
}

function run(g, fronts, seconds, dt = 0.25) {
  for (let t = 0; t < seconds; t += dt) {
    for (const f of fronts) f.update(dt);
    g.update(dt, { x: 0, z: 0 });
  }
}

const LINE = [{ x: 0, z: -200 }, { x: 0, z: 200 }];

/* ---- it runs at its speed ------------------------------------------------ */
{
  const g = grid();
  const f = new FireFront(g, { from: LINE, dir: { x: 1, z: 0 }, speed: 2, scatter: 0.1 });
  run(g, [f], 100);
  const ds = f.cols.map((c) => c.d);
  const mean = ds.reduce((a, b) => a + b, 0) / ds.length;
  ok('a front runs at the speed it is given (2 m/s → ~200 m in 100 s)', mean > 185 && mean < 215, `mean ${mean.toFixed(0)} m, ${Math.min(...ds).toFixed(0)}-${Math.max(...ds).toFixed(0)}`);
  ok('…with a ragged edge (the scatter), not a ruler line', Math.max(...ds) - Math.min(...ds) > 8, `${(Math.max(...ds) - Math.min(...ds)).toFixed(0)} m spread`);
  ok('…lighting the ground it walks into through the grid (flames, scar, cap all the fire\'s own)', g.stats.everLit > 150 && g.burning > 0, `${g.stats.everLit} lit, ${g.burning} burning`);
  const p = { x: 400, z: 0 };
  ok('aheadOf: metres to run before the head is level with a point', Math.abs(f.aheadOf(p) - (400 - f.travel)) < 1e-6 && f.aheadOf({ x: 100, z: 50 }) < 0);
  const lead = f.lead({ x: 400, z: 150 });
  ok('lead(p): the column nearest a point, as a point on the fire', lead && Math.abs(lead.z - 150) < 60 && lead.x > 150 && lead.k >= 0, lead && `${lead.x.toFixed(0)},${lead.z.toFixed(0)}`);
  ok('distanceTo: metres from the nearest part of the front', Math.abs(f.distanceTo({ x: f.travel + 50, z: 0 }) - 50) < 30);
  const before = f.travel;
  f.stop();
  run(g, [f], 20);
  ok('stop() stops it; start() runs it again', f.travel === before && (f.start(), run(g, [f], 10), f.travel > before));
  f.setSpeed(0);
  const t0 = f.travel;
  run(g, [f], 10);
  ok('setSpeed(0) holds it where it is', f.travel === t0);
}

/* ---- water holds it ------------------------------------------------------- */
{
  const g = grid();
  const f = new FireFront(g, { from: LINE, dir: { x: 1, z: 0 }, speed: 2, scatter: 0 });
  run(g, [f], 30); // ~60 m
  // A bucket on the northern half of the head, 40 m ahead of it.
  g.douse(110, -100, 36, 1, 16);
  run(g, [f], 60);
  const north = f.cols.filter((c) => c.z < -140 + 1 && c.z > -150 || (c.z > -130 && c.z < -70));
  const south = f.cols.filter((c) => c.z > 60);
  const nMax = Math.max(...north.map((c) => c.d));
  const sMin = Math.min(...south.map((c) => c.d));
  ok('water ahead of a stretch of the front HOLDS that stretch', nMax < 100, `held columns at ≤ ${nMax.toFixed(0)} m`);
  ok('…and only that stretch: the rest runs on', sMin > 150 && f.held > 0, `the south half at ≥ ${sMin.toFixed(0)} m; ${f.held} held`);
  // Dry it out: the hold lapses with the wet ring.
  g.time += WET_SECONDS + 5;
  run(g, [f], 20);
  ok('when the ground dries the held stretch runs again', Math.max(...north.map((c) => c.d)) > nMax + 10, `${Math.max(...north.map((c) => c.d)).toFixed(0)} m`);
}

/* ---- rock --------------------------------------------------------------- */
{
  const g = grid({ rock: (x) => x > 150 && x < 230 });
  const f = new FireFront(g, { from: LINE, dir: { x: 1, z: 0 }, speed: 4, jump: 30 });
  run(g, [f], 80);
  ok('a band of rock wider than `jump` stops every column for good', f.live === 0 && f.cols.every((c) => c.d <= 165 && c.why === 'barrier'), `travel ${f.travel.toFixed(0)}`);
  const g2 = grid({ rock: (x) => x > 150 && x < 172 });
  const f2 = new FireFront(g2, { from: LINE, dir: { x: 1, z: 0 }, speed: 4, jump: 30 });
  run(g2, [f2], 80);
  ok('…a track narrower than `jump` it throws itself over', f2.travel > 250 && f2.live > 0, `travel ${f2.travel.toFixed(0)}`);
  const g3 = grid({ rock: (x) => x > 150 && x < 172 });
  const f3 = new FireFront(g3, { from: LINE, dir: { x: 1, z: 0 }, speed: 4, jump: 0 });
  run(g3, [f3], 80);
  ok('…unless jump is 0 (a road it must stop at)', f3.travel <= 165 && f3.live === 0, `travel ${f3.travel.toFixed(0)}`);
}

/* ---- the cap ---------------------------------------------------------------- */
{
  const g = grid({ cap: 120 });
  const f = new FireFront(g, { from: [{ x: 0, z: -900 }, { x: 0, z: 900 }], dir: { x: 1, z: 0 }, speed: 6, capShare: 0.85 });
  let peak = 0;
  for (let t = 0; t < 120; t += 0.25) {
    f.update(0.25);
    g.update(0.25, { x: 0, z: 0 });
    peak = Math.max(peak, g.burning);
  }
  ok('a front never pushes the grid past its share of the cap — it waits', peak <= Math.ceil(120 * 0.85) + 1 && f.travel > 0, `peak ${peak} of 120 (share 102)`);
}

/* ---- seek, save and restore ------------------------------------------------- */
{
  const g = grid();
  const f = new FireFront(g, { from: LINE, dir: { x: 1, z: 0 }, speed: 2, band: 60 });
  f.seek(200);
  let burnt = 0;
  let burning = 0;
  for (let i = 0; i < g.n; i++) {
    if (g.state[i] === STATE.BURNT) burnt++;
    if (g.state[i] === STATE.BURNING) burning++;
  }
  ok('seek(d): black behind the band, a band burning at the head — the night\'s fire on the first frame', burnt > 120 && burning > 40 && burning === g.burning, `${burnt} spent, ${burning} burning`);
  const mid = f.cols[Math.floor(f.cols.length / 2)];
  const behind = g.indexAt(40, mid.z);
  const atHead = g.indexAt(mid.d - 15, mid.z);
  ok('…spent well behind the head, burning at it', g.state[behind] === STATE.BURNT && g.state[atHead] === STATE.BURNING);
  run(g, [f], 40);
  // A drop holds part of it, then a checkpoint.
  g.douse(f.travel + 30, -120, 36, 1, 16);
  run(g, [f], 20);
  const saved = JSON.parse(JSON.stringify(f.save()));
  const g2 = grid();
  const f2 = new FireFront(g2, { from: LINE, dir: { x: 1, z: 0 }, speed: 0.5, band: 60 });
  f2.restore(saved);
  const same = f.cols.every((c, k) => Math.abs(c.d - f2.cols[k].d) < 0.11);
  ok('save() → restore() on a fresh grid puts every column back where it was', same && f2.speed === f.speed && f2.running === f.running, `${f.cols.map((c) => c.d.toFixed(0)).slice(0, 5).join(',')} / ${f2.cols.map((c) => c.d.toFixed(0)).slice(0, 5).join(',')}`);
  ok('…with the ground laid the same (burning at the head, black behind)', g2.burning > 30 && g2.state[g2.indexAt(40, 0)] === STATE.BURNT, `${g2.burning} burning`);
  ok('save() is small plain data', JSON.stringify(saved).length < 600 && Array.isArray(saved.d) && saved.d.every(Number.isFinite));
}

/* ---- the scar ------------------------------------------------------------------ */
{
  const g = grid();
  const seen = [];
  g.onChange = (i, st) => seen.push(st);
  const n = g.scorch(0, 0, 60);
  ok('scorch(): fresh fuel in a disc goes straight to spent, and the trees hear about it', n > 20 && seen.length === n && seen.every((st) => st === STATE.BURNT) && g.burning === 0, `${n} cells`);
  g.ignite(0, 0, 80);
  ok('…and a scar never relights (it is a break the fire cannot run back over)', g.state[g.indexAt(0, 0)] === STATE.BURNT && g.burning > 0 && g.burning < 30, `${g.burning} lit round its edge`);
  const g2 = grid({ rock: (x) => x < 0 });
  ok('…rock is not fuel, so it is not scorched', g2.scorch(-100, 0, 40) === 0);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

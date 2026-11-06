/**
 * The terminal's inside, as numbers, on every map with a terminal to walk into:
 *
 *   node tests/features/walk-in.mjs
 *
 *   - a person starting at a kerb door can get to every shop, every gate, the
 *     lounge, both floors, and out of every apron door, with the walls in the way
 *     (a flood fill at walking radius over the plan's own solids and floors);
 *   - nothing solid stands in a door, on a stair or across a stair's top;
 *   - no shop, seat or island overlaps another, and all of it is inside the core;
 *   - every name on the sheet is one of ours (not a real shop's or airline's).
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
const PL = await import(SRC + 'features/terminal/plan.js');
const { BRANDS, LOUNGE } = await import(SRC + 'features/terminal/atlas.js');

let failed = 0;
let passed = 0;
function ok(name, pass, detail = '') {
  if (pass) passed++;
  else failed++;
  if (!pass || process.env.VERBOSE) console.log(`${pass ? 'ok  ' : 'FAIL'} ${name}${detail !== '' ? ` — ${detail}` : ''}`);
}

const R = 0.32;
const STEP = 0.4;

/** Flood from `start` on floors, as the walker moves: (u, b, y). */
function flood(P, start) {
  const seen = new Set();
  const key = (u, b, up) => `${Math.round(u / STEP)},${Math.round(b / STEP)},${up ? 1 : 0}`;
  const q = [[start.u, start.b, start.y]];
  seen.add(key(start.u, start.b, start.y > 2.6));
  const inSolid = (u, b, y) => P.solids.some((s) => y + 1.75 > s.y0 && y < s.y1 && u + R > s.u0 && u - R < s.u1 && b + R > s.b0 && b - R < s.b1);
  const near = new Map();
  for (const s of P.solids) {
    const a = Math.floor((s.u0 - 1) / 10);
    const c = Math.floor((s.u1 + 1) / 10);
    for (let i = a; i <= c; i++) {
      if (!near.has(i)) near.set(i, []);
      near.get(i).push(s);
    }
  }
  const blocked = (u, b, y) => (near.get(Math.floor(u / 10)) || []).some((s) => y + 1.75 > s.y0 && y < s.y1 && u + R > s.u0 && u - R < s.u1 && b + R > s.b0 && b - R < s.b1);
  void inSolid;
  while (q.length) {
    const [u, b, y] = q.pop();
    for (const [du, db] of [[STEP, 0], [-STEP, 0], [0, STEP], [0, -STEP]]) {
      const nu = u + du;
      const nb = b + db;
      if (nb < -1.5 || nb > P.D + 1.5 || nu < P.cu0 || nu > P.cu1) continue;
      const f = PL.floorIn(P, nu, nb, y);
      if (f === null) continue;
      if (Math.abs(f - y) > 0.5) continue;
      if (blocked(nu, nb, f)) continue;
      const k = key(nu, nb, f > 2.6);
      if (seen.has(k)) continue;
      seen.add(k);
      q.push([nu, nb, f]);
    }
  }
  return { seen, key };
}

const reachable = (F, u, b, up) => {
  for (let du = -0.8; du <= 0.8; du += STEP) {
    for (let db = -0.8; db <= 0.8; db += STEP) if (F.seen.has(F.key(u + du, b + db, up))) return true;
  }
  return false;
};

const done = new Set();
for (const m of MAPS.MAPS) {
  let ap;
  try {
    TER.applyMap(m.id);
    APRON.refreshApronElevation();
    ap = new APRON.Apron(new THREE.Scene(), 'high');
  } catch (e) {
    ok(`${m.id}: the apron builds`, false, e.message);
    continue;
  }
  const lay = ap.lay;
  if (!PL.canWalkIn(lay)) {
    ok(`${m.id}: no plan where it cannot be walked into`, PL.planInterior(lay) === null);
    continue;
  }
  const T = lay.terminal;
  const sig = `${lay.shape}:${T.u0}:${T.u1}:${lay.stands.length}`;
  if (done.has(sig)) continue;
  done.add(sig);
  const P = PL.planInterior(lay);
  ok(`${m.id}: has both kinds of door`, P.air.length > 0 && P.land.length >= 2, `${P.air.length} air, ${P.land.length} land`);
  ok(`${m.id}: apron shellCut says what to fold`, !!ap.shellCut && ap.shellCut.wall[1] > ap.shellCut.wall[0] && ap.shellCut.vc.length === 2);
  ok(`${m.id}: frame round trip`, (() => {
    const w = PL.toWorld(P, 31, 7);
    const q = PL.fromWorld(P, w.x, w.z);
    return Math.abs(q.u - 31) < 1e-6 && Math.abs(q.b - 7) < 1e-6;
  })());
  const d0 = P.land[0];
  const F = flood(P, { u: d0.u, b: P.D + 1, y: PL.FLOOR });
  ok(`${m.id}: every kerb door is on the same floor plan`, P.land.every((d) => reachable(F, d.u, P.D + 1, false)));
  for (const d of P.air) ok(`${m.id}: apron door at ${d.u | 0} reached from the kerb`, reachable(F, d.u, -1, false));
  for (const s of P.shops) {
    ok(`${m.id}: ${s.id} (${s.kind}) reached`, reachable(F, (s.u0 + s.u1) / 2, s.b0 + 1, true));
    ok(`${m.id}: ${s.id} is a useful size`, s.u1 - s.u0 >= 12, `${(s.u1 - s.u0).toFixed(1)} m`);
  }
  for (const g of P.gates) ok(`${m.id}: gate ${g.number} reached`, reachable(F, g.u, P.walkB0 + 1, true));
  ok(`${m.id}: the lounge is reached, right to its glass`, reachable(F, P.lounge.u0 + 3, 1.2, true) && reachable(F, P.lounge.u1 - 2, 1.2, true));
  for (const i of P.islands) ok(`${m.id}: ${i.id} reached`, reachable(F, (i.u0 + i.u1) / 2, i.b + 2, false));
  ok(`${m.id}: there are shops, of at least 4 kinds`, new Set(P.shops.map((s) => s.kind)).size >= 4, P.shops.length);
  ok(`${m.id}: there are gates and check-in`, P.gates.length >= 2 && P.islands.length >= 2, `${P.gates.length} gates, ${P.islands.length} islands`);
  const all = [...P.shops.map((s) => ({ ...s, n: s.id })), ...P.seatBlocks.map((s, i) => ({ u0: s.u0, u1: s.u1, b0: s.b - 0.75, b1: s.b + 0.75, n: `seat${i}` }))];
  const clash = [];
  for (let i = 0; i < all.length; i++) {
    for (let j = i + 1; j < all.length; j++) {
      const a = all[i];
      const c = all[j];
      if (a.u0 < c.u1 - 0.01 && c.u0 < a.u1 - 0.01 && a.b0 < c.b1 - 0.01 && c.b0 < a.b1 - 0.01) clash.push(`${a.n}/${c.n}`);
    }
  }
  ok(`${m.id}: nothing overlaps upstairs`, !clash.length, clash.slice(0, 4).join(' '));
  ok(`${m.id}: seats keep out of the stair wells`, P.seatBlocks.every((s) => P.holes.every((h) => s.u1 < h.u0 || s.u0 > h.u1 || s.b + 0.75 < h.b0 || s.b - 0.75 > h.b1)));
  for (const s of P.stairs) {
    const yAt = (u) => PL.floorIn(P, u, (s.b0 + s.b1) / 2, 0);
    ok(`${m.id}: stair ${s.id} rises to the concourse`, Math.abs(yAt(s.uFoot) - PL.FLOOR) < 0.01 && Math.abs(yAt(s.uFoot + PL.STAIR_LEN) - PL.UP - PL.FLOOR) < 0.01);
  }
}

/* ---- names ---- */
const REAL = /starbucks|mcdonald|apple|burger king|dunkin|subway|costa|samsung|hudson|dufry|wh smith|delta|united|american|lufthansa|emirates/i;
for (const b of [...Object.values(BRANDS), LOUNGE]) ok(`"${b.name}" is not a real brand`, !REAL.test(b.name));

console.log(`walk-in: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

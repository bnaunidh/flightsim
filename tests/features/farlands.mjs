/**
 * The World Map past the sea (world/worldmap/farlands.js), checked in node.
 *
 *   /opt/homebrew/bin/node tests/features/farlands.mjs           one line per check
 *   /opt/homebrew/bin/node tests/features/farlands.mjs --quiet   failures and the summary
 *
 *   - the height profile by distance: sea, then the range, then the
 *     Farlands, then nothing, on all four sides and a corner
 *   - eight passes a Skylark can clear, and each runs on as a slot to the edge
 *   - no peak up to the fighters' ceilings; plenty of canyon and gap
 *   - strangeness that ramps: the ground differs by depth, and gets more exact
 *   - every island clear of the ring; every field, its lanes, and the rules
 *     (checkAirport, checkNetwork) unchanged; the same heights to the byte
 *     inside the sea with the ring on and off
 *   - no other map changes: heightAt on all of them with the hook in place
 *   - the void: no ground, no tile, black on both charts
 *   - the stream builds the ring inside the mainland's budget
 *   - cheap: a sample costs less than a mainland one
 *   - first load: no bigger than v76.9 (1,494,347 B gzipped)
 */
import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';

global.document = {
  createElement: () => ({
    getContext: () => new Proxy({}, { get: () => () => ({ addColorStop() {}, data: new Uint8ClampedArray(4) }) }),
    width: 0, height: 0, style: {},
  }),
  body: { appendChild() {} },
};
const store = new Map();
global.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
global.window = global.window || { addEventListener() {} };

const SRC = new URL('../../src/', import.meta.url).href;
const T = await import(SRC + 'world/terrain.js');
const M = await import(SRC + 'world/maps.js');
const PV = await import(SRC + 'world/worldmap/preview.js');
const TL = await import(SRC + 'world/worldmap/tiles.js');
const ST = await import(SRC + 'world/worldmap/stream.js');
const F = await import(SRC + 'world/worldmap/farlands.js');
const SH = await import(SRC + 'features/livemap/shade.js');

const quiet = process.argv.includes('--quiet');
const results = [];
const ok = (name, pass, detail = '') => {
  results.push({ name, pass: !!pass });
  if (!quiet || !pass) console.log(`${pass ? 'PASS' : 'FAIL'} ${name}${detail ? ` -- ${detail}` : ''}`);
};
const t0 = performance.now();

const { SEA_HALF, RANGE_DEEP, EDGE_D, WOBBLE, TEAR, VOID_H, PEAK_MAX, PASS_TOP, SLOT_TOP, CUTS, FARLANDS, cutCentre, cutFloor } = F;
const def = PV.previewDef();

/* ---- Reset all: the ring is new again ---- */
{
  const ST0 = await import(SRC + 'core/storage.js');
  store.set('islandsim.farlands.v1', JSON.stringify({ seen: true, edge: true, furthest: 9000 }));
  ST0.resetAll();
  ok('Reset all clears the first-visit memory', !store.has('islandsim.farlands.v1'));
}

/* ---- the ring off: what the World Map was ---- */
T.applyMap(def);
ok('with the ring not loaded, past the sea is still sea', T.heightAt(SEA_HALF + 30000, 0) === def.seaFloor, `${T.heightAt(SEA_HALF + 30000, 0)}`);
const inside = [];
for (const a of PV.AIRPORTS) {
  for (let u = -1; u <= 1; u += 0.25) {
    for (const v of [-900, -150, 0, 150, 900]) inside.push([a.x + (u * a.length) / 2 + u * 7000, a.z + v]);
  }
}
for (const i of def.islands) for (let k = 0; k < 8; k++) inside.push([i.cx + Math.cos(k) * i.radius * 1.3, i.cz + Math.sin(k) * i.radius * 1.3]);
const before = inside.map(([x, z]) => T.heightAt(x, z));

/* ---- the ring on ---- */
def.farlands = true;
def._outer = FARLANDS;
T.applyMap(def);
const after = inside.map(([x, z]) => T.heightAt(x, z));
const moved = after.filter((h, i) => h !== before[i]).length;
ok('every field, lane and island: the same ground, to the bit, with the ring on', moved === 0, `${after.length} points, ${moved} moved`);
{
  let worst = -Infinity;
  for (const i of def.islands) {
    for (let k = 0; k < 24; k++) {
      const a = (k / 24) * Math.PI * 2;
      worst = Math.max(worst, F.depthOf(i.cx + Math.cos(a) * i.radius * 1.45, i.cz + Math.sin(a) * i.radius * 1.45));
    }
  }
  ok('every island\'s furthest reach (1.45 R) is clear of the ring and its wander', worst < -WOBBLE - 100, `nearest ${(-worst / 1000).toFixed(1)} km inside the coast line`);
}
{
  const bad = [];
  for (const a of PV.AIRPORTS) {
    PV.setDeparture(a.id);
    T.applyMap(def);
    for (const r of PV.checkAirport(T, a)) if (!r.pass) bad.push(`${r.airport} ${r.rule}: ${r.detail}`);
  }
  PV.setDeparture(PV.HUB_ID);
  T.applyMap(def);
  ok('checkAirport: every rule at every field, from every departure', bad.length === 0, bad.slice(0, 3).join('; '));
  const net = PV.checkNetwork().filter((r) => !r.pass);
  ok('checkNetwork: every rule', net.length === 0, net.map((r) => r.rule).join('; '));
}

/* ---- the profile, on every side ---- */
const SIDES = {
  east: (D, s) => [SEA_HALF + D, s],
  west: (D, s) => [-SEA_HALF - D, s],
  north: (D, s) => [s, -SEA_HALF - D],
  south: (D, s) => [s, SEA_HALF + D],
};
const CORNER_AT = (D) => {
  const I = SEA_HALF - F.CORNER;
  const o = (F.CORNER + D) / Math.SQRT2;
  return [I + o, -I - o];
};
for (const [name, at] of Object.entries(SIDES)) {
  const stat = (d0, d1) => {
    let max = -Infinity;
    let min = Infinity;
    let sum = 0;
    let n = 0;
    for (let d = d0; d < d1; d += 1000) {
      for (let s = -80000; s <= 80000; s += 8000) {
        const h = T.heightAt(...at(d, s));
        max = Math.max(max, h);
        min = Math.min(min, h);
        sum += h;
        n++;
      }
    }
    return { max, min, mean: sum / n };
  };
  const sea = stat(-6000, -WOBBLE - 400);
  const range = stat(14000, RANGE_DEEP - 6000);
  const far = stat(RANGE_DEEP + 14000, EDGE_D - TEAR - 6000);
  ok(`${name}: sea, then the range, then the Farlands`, sea.max === def.seaFloor && range.mean > 1200 && range.max > 2800 && far.mean > 1800 && far.max > 4500,
    `sea ${sea.max}, range mean ${range.mean.toFixed(0)} max ${range.max.toFixed(0)}, Farlands mean ${far.mean.toFixed(0)} max ${far.max.toFixed(0)}`);
  const voidMax = stat(EDGE_D + WOBBLE + TEAR + 100, EDGE_D + 60000).max;
  ok(`${name}: past the edge, the void: no ground at all`, voidMax === VOID_H, `${voidMax}`);
}
{
  const hs = [];
  for (let D = 2000; D < EDGE_D + 16000; D += 2000) hs.push(T.heightAt(...CORNER_AT(D)));
  const last = hs[hs.length - 1];
  ok('a corner: ground all the way out, then the void', hs.slice(4, 60).every((h) => h > 300) && last === VOID_H, `min ${Math.min(...hs.slice(4, 60)).toFixed(0)}, last ${last}`);
}
{
  // The range rises from the coast: no wall standing in the sea.
  let steepest = 0;
  for (let z = -90000; z < 90000; z += 3000) {
    for (let D = -3000; D < 6000; D += 200) {
      const a = Math.max(0, T.heightAt(SEA_HALF + D, z));
      const b = Math.max(0, T.heightAt(SEA_HALF + D + 200, z));
      steepest = Math.max(steepest, Math.abs(b - a) / 200);
    }
  }
  ok('the range rises from the coast (no cliff in the first few kilometres)', steepest < 1.4, `steepest ${steepest.toFixed(2)}`);
}
{
  // A continuous range: at no point round the ring is it open water, or a low gap that is not a pass.
  let leaks = 0;
  for (const [, at] of Object.entries(SIDES)) {
    for (let s = -80000; s <= 80000; s += 1000) {
      let top = -Infinity;
      for (let D = 8000; D < RANGE_DEEP - 4000; D += 400) top = Math.max(top, T.heightAt(...at(D, s)));
      if (top < PASS_TOP - 200) leaks++;
    }
  }
  ok('the range is continuous: nothing lower than a pass goes through it', leaks === 0, `${leaks} leaks`);
}

/* ---- the passes ---- */
const SKYLARK_M = 14000 / 3.28084;
{
  const cuts = [];
  const side = {
    east: (D, c) => [SEA_HALF + D, cutCentre(c, D)],
    west: (D, c) => [-SEA_HALF - D, cutCentre(c, D)],
    north: (D, c) => [cutCentre(c, D), -SEA_HALF - D],
    south: (D, c) => [cutCentre(c, D), SEA_HALF + D],
  };
  for (const [s, list] of Object.entries(CUTS)) for (const c of list) cuts.push({ name: `${s} ${c.at / 1000} km`, c, at: side[s] });
  ok('eight passes, two a side', cuts.length === 8);
  const wander = (x, z) => F.wanderOf(x, z) - F.depthOf(x, z);
  for (const { name, c, at } of cuts) {
    // Flown along the centre line at the depth the ground itself uses.
    let topR = -Infinity;
    let topF = -Infinity;
    let wide = Infinity;
    for (let D = 1000; D < EDGE_D - TEAR - 800; D += 250) {
      const [x0, z0] = at(D, c);
      const Dw = D - wander(x0, z0);
      const [x, z] = at(Dw, c);
      const eastWest = name.startsWith('east') || name.startsWith('west');
      // The lowest way through at this depth, within a slot's width of the line.
      let h = Infinity;
      for (let o = -500; o <= 500; o += 100) h = Math.min(h, T.heightAt(x + (eastWest ? 0 : o), z + (eastWest ? o : 0)));
      if (D < RANGE_DEEP) topR = Math.max(topR, h);
      else topF = Math.max(topF, h);
      if (D > RANGE_DEEP + 8000 && D % 1000 === 0) {
        // How wide is the gap at the floor plus 400 m? Measured across the ring.
        const f = cutFloor(Dw) + 400;
        let w = 0;
        for (const sign of [-1, 1]) {
          let o = 0;
          while (o < 2000) {
            const dx = name.startsWith('east') || name.startsWith('west') ? 0 : o * sign;
            const dz = dx ? 0 : o * sign;
            if (T.heightAt(x + dx, z + dz) > f) break;
            o += 20;
          }
          w += o;
        }
        wide = Math.min(wide, w);
      }
    }
    ok(`pass ${name}: a Skylark clears it, and a slot runs to the edge`, topR < 2200 && topF <= SLOT_TOP + 60 && topR < SKYLARK_M - 1500 && wide >= 900,
      `highest in the range ${topR.toFixed(0)} m, in the Farlands ${topF.toFixed(0)} m, narrowest ${wide} m`);
  }
}

/* ---- peaks and gaps ---- */
{
  let peak = -Infinity;
  let open = 0;
  let n = 0;
  const hist = new Map();
  for (let D = RANGE_DEEP; D < EDGE_D - 1000; D += 300) {
    for (let s = -110000; s <= 110000; s += 700) {
      const h = T.heightAt(SEA_HALF + D, s);
      peak = Math.max(peak, h);
      n++;
      if (h < 2600) open++;
      const k = Math.round(h / 100);
      hist.set(k, (hist.get(k) || 0) + 1);
    }
  }
  const fighter = 42000 / 3.28084;
  ok('no peak reaches the fighters\' ceiling', peak < PEAK_MAX && PEAK_MAX < fighter, `highest ${peak.toFixed(0)} m (${(peak * 3.28084).toFixed(0)} ft)`);
  ok('awe: something out there is over 9 km high', peak > 9000, `${peak.toFixed(0)} m`);
  ok('flyable: a third or more of the Farlands is canyon, gap or low bench', open / n > 0.33, `${((100 * open) / n).toFixed(0)}% under 2,600 m`);
}

/* ---- a ramp of strangeness, not one texture ---- */
{
  // How much of the ground lands on an exact grid or band: the same statistic through the depth.
  const band = (from, to) => {
    const hs = [];
    for (let D = from; D < to; D += 150) for (let s = -60000; s <= 60000; s += 3100) hs.push(T.heightAt(SEA_HALF + D, s + 0.5 * D));
    const m = hs.reduce((a, b) => a + b, 0) / hs.length;
    const sd = Math.sqrt(hs.reduce((a, b) => a + (b - m) * (b - m), 0) / hs.length);
    return { m, sd };
  };
  const zones = [band(50000, 64000), band(72000, 88000), band(102000, 118000), band(124000, 134000)];
  const distinct = zones.every((a, i) => zones.every((b, j) => i === j || Math.abs(a.m - b.m) > 120 || Math.abs(a.sd - b.sd) > 120));
  ok('four zones with four different shapes', distinct, zones.map((z) => `${z.m.toFixed(0)}±${z.sd.toFixed(0)}`).join('  '));
  // The ribs close up with depth: fewer metres between crests.
  const crests = (from, to) => {
    let c = 0;
    let was = 0;
    for (let D = from; D < to; D += 60) {
      const h = T.heightAt(SEA_HALF + D, -8000);
      if (h > 3000 && was <= 3000) c++;
      was = h;
    }
    return (to - from) / Math.max(1, c);
  };
  const early = crests(64000, 82000);
  const late = crests(86000, 104000);
  ok('the bands tighten the further in you go', late < early, `a crest every ${early.toFixed(0)} m, then every ${late.toFixed(0)} m`);
}

/* ---- the cover the ring asks for ---- */
{
  const out = new Float32Array(8);
  F.coverOf(SEA_HALF + 90000, 500, 3000, 1.5, out);
  ok('the Farlands have no fields, forest or marsh, carry their zone, and read steep as rock', out[3] === 0 && out[4] === 0 && out[6] === 0 && out[2] === 1 && out[7] > 0.3 && out[7] < 0.9, [...out].map((v) => v.toFixed(2)).join(' '));
  // The foot of the range: no sand band round the sea (it read as one pale line at sunset).
  {
    let sand = 0;
    let sum = 0;
    for (let z = -60000; z <= 60000; z += 4000) for (const h of [2, 5, 9, 12]) {
      F.coverOf(SEA_HALF + 300, z, h, 0.15, out);
      sand = Math.max(sand, out[0]);
      sum = Math.max(sum, Math.abs(out[0] + out[1] + out[2] - 1));
    }
    ok('the range\'s foot is not a beach, and its cover still adds up', sand === 0 && sum < 1e-4, `sand ${sand}, off by ${sum}`);
  }
  F.coverOf(SEA_HALF + 16000, 500, 2000, 0.2, out);
  ok('the range above the tree line is bare', out[4] === 0 && out[5] === 0 && out[3] === 0 && out[7] === 0);
}

/* ---- no other map ---- */
{
  const ids = M.MAPS.map((m) => m.id);
  const sum = (id) => {
    T.applyMap(id);
    const a = [];
    for (let x = -14000; x <= 14000; x += 1700) for (let z = -14000; z <= 14000; z += 1700) a.push(T.heightAt(x, z));
    return a;
  };
  let bad = 0;
  for (const id of ids) {
    const map = M.getMap(id);
    if (map._outer) bad++;
    const off = sum(id);
    // The hook is the only thing past the sea; a map that has none must be untouched by a ring that exists.
    map._outer = null;
    const on = sum(id);
    delete map._outer;
    if (off.some((h, i) => h !== on[i])) bad++;
  }
  ok(`none of the ${ids.length} other maps has the ring, and each reads the same ground`, bad === 0 && ids.length > 8, `${bad} differ`);
  const src = readFileSync(new URL('../../src/world/terrain.js', import.meta.url), 'utf8');
  ok('terrain.js has one line of it: the hook, read off the map', (src.match(/MAP\._outer/g) || []).length === 3 && /if \(MAP\._outer && MAP\._outer\.past\(x, z\)\) return MAP\._outer\.height\(x, z\);/.test(src));
  T.applyMap(def);
}

/* ---- the void ---- */
{
  const heights = new Float32Array(35 * 35).fill(VOID_H);
  ok('a tile in the void keeps no mesh', TL.assemble(heights, 300000, 0, 8192, 32) === null);
  const stream = new ST.TerrainStream({ T, material: {}, group: { add() {}, remove() {} }, quality: 'low', def, useWorker: false });
  ok('the stream has land in the range, in the Farlands, at the torn edge', stream.hasLand(SEA_HALF + 20000, 0, 8192) && stream.hasLand(SEA_HALF + 90000, 0, 8192) && stream.hasLand(SEA_HALF + EDGE_D, 0, 8192));
  ok('the stream has none far into the void', !stream.hasLand(SEA_HALF + EDGE_D + 40000, 0, 8192));
  stream.dispose();
  const w = 3;
  const H = new Float32Array((w + 2) * (w + 2)).fill(VOID_H);
  const rgba = new Uint8ClampedArray(w * w * 4);
  SH.shadeRows(H, w, 100, SH.chartStyle(def.palette), rgba);
  ok('the live map paints the void black, not sea', rgba[0] < 16 && rgba[1] < 16 && rgba[2] < 16, `${rgba[0]},${rgba[1]},${rgba[2]}`);
  const srcM = readFileSync(new URL('../../src/ui/minimap.js', import.meta.url), 'utf8');
  ok('the minimap paints it black too (under -99 m, which no sea floor is)', /const k = h < -99 \? 9 : Math\.min\(1, -h \/ 60\);/.test(srcM) && VOID_H < -99 && M.MAPS.every((m) => m.seaFloor > -99));
}

/* ---- the same budget ---- */
{
  // Flown out, at a fighter's cruise, past the coast to the edge, with the main-thread fallback the node harness has.
  let clock = 0;
  const group = { children: [], add(m) { this.children.push(m); }, remove(m) { this.children.splice(this.children.indexOf(m), 1); } };
  const stream = new ST.TerrainStream({ T, material: {}, group, quality: 'low', def, useWorker: false, now: () => clock });
  let maxMesh = 0;
  let maxWanted = 0;
  const y = 7000;
  for (let x = SEA_HALF - 30000; x < SEA_HALF + EDGE_D + 20000; x += 600) {
    clock += 16;
    for (let k = 0; k < 6; k++) {
      clock += 1;
      stream.update(1 / 60, x, y, 2000);
    }
    const s = stream.stats();
    maxMesh = Math.max(maxMesh, s.meshes);
    maxWanted = Math.max(maxWanted, s.wanted);
  }
  ok('over the ring at Low: never more meshes than the tier\'s cap', maxMesh <= stream.tier.maxTiles, `${maxMesh} of ${stream.tier.maxTiles}, ${maxWanted} wanted at most`);
  ok('over the ring at Low: it wants no more than the mainland (about 100)', maxWanted <= 112, `${maxWanted}`);
  stream.dispose();
}
{
  // Cost: a Farlands sample against a mainland one, in the same run.
  const land = [];
  const ring = [];
  for (let i = 0; i < 4000; i++) {
    land.push([-70000 + (i % 200) * 73, 7000 + ((i * 37) % 200) * 71]);
    ring.push([SEA_HALF + 10000 + (i % 400) * 300, (i * 53) % 90000]);
  }
  const time = (list) => {
    const t = performance.now();
    let s = 0;
    for (let k = 0; k < 8; k++) for (const [x, z] of list) s += T.heightAt(x, z);
    return (performance.now() - t) / (8 * list.length);
  };
  time(ring);
  time(land);
  const a = time(land);
  const b = time(ring);
  ok('a ring sample costs less than a mainland one', b < a, `${(b * 1000).toFixed(2)} µs against ${(a * 1000).toFixed(2)} µs`);
  // And the sea's: two compares before anything else happens.
  ok('the sea does no ring sums at all', F.past(0, 0) === false && F.past(SEA_HALF - F.CORNER - 1, 0) === false);
}

/* ---- first load ---- */
{
  const IMPORT_RE = /(?:^|\n)\s*(?:import|export)\s+(?:[^'"\n;]*?\s+from\s+)?['"]([^'"]+)['"]/g;
  const seen = new Map();
  const walk = (url) => {
    const k = url.href;
    if (seen.has(k)) return;
    let text = '';
    try {
      text = readFileSync(url, 'utf8');
    } catch {
      seen.set(k, 0);
      return;
    }
    seen.set(k, gzipSync(text, { level: 6 }).length);
    let m;
    while ((m = IMPORT_RE.exec(text))) if (m[1].startsWith('.')) walk(new URL(m[1], url));
  };
  walk(new URL('../../src/main.js', import.meta.url));
  const gz = [...seen.values()].reduce((a, b) => a + b, 0);
  const ring = [...seen.keys()].filter((k) => /\/farlands(-look|-run)?\.js$/.test(k));
  ok('first load: nothing of the ring is in main.js\'s static graph', ring.length === 0, ring.join(' '));
  ok('first load: no bigger than v76.9 (1,494,347 B gzipped)', gz <= 1494347, `${gz} B`);
}

const fails = results.filter((r) => !r.pass);
console.log(`\n${results.length - fails.length}/${results.length} passed, ${(performance.now() - t0).toFixed(0)} ms`);
process.exit(fails.length ? 1 : 0);

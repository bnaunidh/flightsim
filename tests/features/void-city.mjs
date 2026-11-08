/**
 * Nullspire, the hidden city in the void (world/worldmap/void-city.js),
 * checked in node:
 *
 *   /opt/homebrew/bin/node tests/features/void-city.mjs
 *
 *   - where it is: 100 km past the edge, straight out along the east[0]
 *     canyon's line (hold 090 from the canyon's end)
 *   - the ground: the slab's top at SLAB_Y, flat under the whole field, the
 *     void all round it and under its cliffs; the stream knows it is there
 *   - hidden: hushed, it is the void; every chart's box stops short of it;
 *     clampFar never puts a pin on it; the ring's labels do not name it; the
 *     field is on no airport list
 *   - the field: a hub, 3,600 m, laid out inside the slab with the city clear
 *     of its approach; the dev approach start is west of its 09 threshold
 *   - the layout: the towers all on the slab, the spires first at every tier,
 *     the bridges between tall neighbours
 *   - the run no longer ends by distance (farlands-run.js), only by the floor
 *   - first load: nothing of the city in main.js's static graph
 */
import { readFileSync } from 'node:fs';

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
const PV = await import(SRC + 'world/worldmap/preview.js');
const ST = await import(SRC + 'world/worldmap/stream.js');
const F = await import(SRC + 'world/worldmap/farlands.js');
const PF = await import(SRC + 'world/worldmap/pin-far.js');
const C = await import(SRC + 'world/worldmap/void-city.js');

const results = [];
const ok = (name, pass, detail = '') => {
  results.push({ name, pass: !!pass });
  console.log(`${pass ? 'PASS' : 'FAIL'} ${name}${detail ? ` -- ${detail}` : ''}`);
};
const { SEA_HALF, EDGE_D, CUTS, cutCentre, FARLANDS, VOID_H } = F;
const { CITY, CITY_FIELD, SLAB_Y, SLAB_RX, SLAB_RZ } = C;
const def = PV.previewDef();
def.farlands = true;
def._outer = FARLANDS;
T.applyMap(def);

/* ---- where ---- */
ok('100 km past the edge, east', CITY.x === SEA_HALF + EDGE_D + CITY.pastEdge && F.depthOf(CITY.x, CITY.z) === EDGE_D + 100000, `D ${F.depthOf(CITY.x, CITY.z)}`);
{
  const end = cutCentre(CUTS.east[0], EDGE_D);
  ok('on the east[0] canyon\'s line: hold 090 from its end and you hit it', Math.abs(CITY.z - end) < 1000 && CITY.headingDeg === 90, `canyon ends at z ${end.toFixed(0)}, city at ${CITY.z}`);
}

/* ---- the ground ---- */
ok('the slab\'s top is the ground, through terrain.js', T.heightAt(CITY.x, CITY.z) === SLAB_Y && T.heightAt(CITY.x - 3000, CITY.z + 1200) === SLAB_Y);
{
  let flat = true;
  let lowest = Infinity;
  const f = CITY_FIELD;
  for (let u = -f.length / 2 - 240; u <= f.length / 2 + 240; u += 60) {
    for (let v = -620; v <= 120; v += 40) {
      const h = T.heightAt(f.x + u, f.z + v);
      lowest = Math.min(lowest, h);
      if (h !== SLAB_Y) flat = false;
    }
  }
  ok('flat under the whole field, overruns and terminal included', flat, `lowest ${lowest}`);
  let voids = 0;
  let n = 0;
  for (let a = 0; a < Math.PI * 2; a += 0.1) {
    n++;
    if (T.heightAt(CITY.x + Math.cos(a) * (SLAB_RX + 900), CITY.z + Math.sin(a) * (SLAB_RZ + 900)) === VOID_H) voids++;
  }
  ok('the void all round it', voids === n, `${voids} of ${n}`);
  // The cliff: from the top to the void in under a kilometre, wherever the rim is.
  let drop = 0;
  for (let r = 0; r < 1400; r += 20) {
    const h = T.heightAt(CITY.x + SLAB_RX - 600 + r, CITY.z);
    if (h === VOID_H) {
      drop = r;
      break;
    }
  }
  ok('a cliff, not a slope: top to nothing inside a few hundred metres', drop > 0 && drop < 1200, `${drop} m`);
}
{
  const stream = new ST.TerrainStream({ T, material: {}, group: { add() {}, remove() {} }, quality: 'low', def, useWorker: false });
  ok('the stream knows the slab is there, and nothing 30 km either side', stream.hasLand(CITY.x, CITY.z, 8192) && stream.hasLand(CITY.x + 4000, CITY.z - 2000, 2048) && !stream.hasLand(CITY.x - 30000, CITY.z, 8192) && !stream.hasLand(CITY.x, CITY.z + 30000, 8192));
  stream.dispose();
}

/* ---- hidden ---- */
{
  FARLANDS.hush(true);
  const hushed = T.heightAt(CITY.x, CITY.z);
  FARLANDS.hush(false);
  ok('hushed (the minimap sampling), the city is the void; unhushed, the slab', hushed === VOID_H && T.heightAt(CITY.x, CITY.z) === SLAB_Y && !FARLANDS.hushed());
  ok('every chart stops short: CHART_HALF is 50 km or more inside it', F.CHART_HALF + 50000 < Math.abs(CITY.x) - SLAB_RX, `±${F.CHART_HALF / 1000} km, city from ${(Math.abs(CITY.x) - SLAB_RX) / 1000} km`);
  const pin = PF.clampFar(CITY.x, CITY.z);
  ok('a pin dropped on it comes back to the land', C.cityDist(pin.x, pin.z) > 90000 && T.heightAt(pin.x, pin.z) > -99, `${((pin.x) / 1000).toFixed(0)} km`);
  ok('the ring\'s names do not name it', !FARLANDS.labels.some((l) => /Nullspire/.test(l.name)));
  ok('the field is on no airport list', !PV.AIRPORTS.some((a) => a.code === CITY_FIELD.code || a.id === CITY_FIELD.id));
}

/* ---- the field ---- */
{
  const f = CITY_FIELD;
  ok('a hub: 3,600 m by 60 m, 09/27, at the slab\'s height', f.kind === 'hub' && f.length >= 3000 && f.halfWidth >= 25 && f.elev === SLAB_Y && f.layout.cls === 'hub');
  ok('terminal, tower, a ramp (no apron: no airliners), taxiway, hangars, fuel, fire', !!f.layout.terminal && !!f.layout.tower && f.layout.pavement.some((p) => p.kind === 'ramp') && !f.layout.pavement.some((p) => p.kind === 'apron') && f.layout.pavement.some((p) => p.kind === 'taxiway') && f.layout.hangars.length >= 2 && !!f.layout.fuel && !!f.layout.fire);
  const ap = C.approachStart();
  ok('the dev approach start: a long final west of 09, nose on the runway', ap.x < f.x - f.length / 2 - 8000 && ap.z === f.z && ap.headingDeg === 90 && ap.y > SLAB_Y + 400 && T.heightAt(ap.x, ap.z) === VOID_H);
  const rw = C.cityRunway();
  ok('the runway record is the field\'s', rw.cx === f.x && rw.cz === f.z && rw.length === f.length && rw.halfWidth === f.halfWidth);
}

/* ---- the layout ---- */
{
  const towers = C.towerLayout(560);
  const low = C.towerLayout(C.CITY_TIERS.low.towers);
  const f = CITY_FIELD;
  const onSlab = towers.every((t) => T.heightAt(CITY.x + t.x, CITY.z + t.z) === SLAB_Y);
  const clear = towers.every((t) => CITY.z + t.z + t.d / 2 < f.z - 620 - 60);
  const spires = towers.filter((t) => t.spire).length;
  ok(`${towers.length} towers, all on the slab, all clear of the field`, towers.length >= 500 && onSlab && clear);
  ok('five spires, the tallest things, first at every tier', spires === 5 && low.filter((t) => t.spire).length === 5 && Math.max(...towers.map((t) => t.h)) === Math.max(...towers.filter((t) => t.spire).map((t) => t.h)));
  ok('Low keeps the heart: its towers are the tallest of the full set', low.length === C.CITY_TIERS.low.towers && low.slice(5).every((t) => t.h >= 30));
  const bridges = C.bridgeLayout(towers, 70);
  ok('light bridges between tall neighbours, under their roofs', bridges.length >= 30 && bridges.every((b) => Math.hypot(b.ax - b.bx, b.az - b.bz) <= 2 * C.STREET + 20 && b.y >= 40));
  // No tower under the 09 approach: the final crosses the slab's west rim south of the core.
  const under = towers.filter((t) => Math.abs(CITY.z + t.z - f.z) < 300 && CITY.x + t.x < f.x - f.length / 2);
  ok('nothing stands under the final', under.length === 0, `${under.length}`);
}

/* ---- the run ---- */
{
  const run = readFileSync(new URL('../../src/features/farlands-run.js', import.meta.url), 'utf8');
  const ring = readFileSync(new URL('../../src/world/worldmap/farlands.js', import.meta.url), 'utf8');
  ok('the run no longer ends by distance: VOID_RUN_ON is gone', !/VOID_RUN_ON/.test(run) && !/VOID_RUN_ON/.test(ring) && /ac\.pos\.y < VOID_FLOOR_Y && groundAt\(x, z\) < -99\) this\.lost\(d\);/.test(run));
  ok('the deep void begins past the city', F.DEEP_FROM > EDGE_D + CITY.pastEdge && F.DEEP_BY > F.DEEP_FROM);
}

/* ---- first load ---- */
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
  const city = [...seen].filter((k) => /void-city(-look)?\.js$/.test(k));
  ok('first load: nothing of the city in main.js\'s static graph', city.length === 0, city.join(' '));
}

const fails = results.filter((r) => !r.pass);
console.log(`\n${results.length - fails.length}/${results.length} passed`);
process.exit(fails.length ? 1 : 0);

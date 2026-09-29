/**
 * The maps, checked in node — every map, every run, in about ten seconds.
 *
 *   node tests/features/maps.mjs            prints one line per check
 *   node tests/features/maps.mjs --quiet    prints failures and the summary
 *
 * Exits 1 if anything fails. No browser, no build: the terrain is one
 * analytic function and the scenery is plain three.js objects, so both can
 * be built and measured here with a stub canvas, and the things that have
 * gone wrong on these maps before — every one of them found late, by
 * somebody flying over it — are all questions about numbers:
 *
 *   - the runway is at field elevation along its whole length, both strips
 *   - the aeroplane's spawn point is on the runway, not inside a hill
 *   - every harbour has 3 m under a 1 m keel at the quay and at the mouth
 *   - every shoal that declares water over it is in the water, and every
 *     shoal drawn as breaking water really comes within 1.8 m of the surface
 *   - every courier place has tarmac within 220 m, and is on the same road
 *     network as the depot (roads that touch are one network) — measured
 *     on the roads boot lays, not on a map with no roads
 *   - every authored road point is [x, z, y] (the ground agrees with y)
 *   - every lighthouse coordinate is on land, as written — jobs.js drives the
 *     van to the written coordinate, not to wherever the builder moved it
 *   - every helipad that is not a ship's deck is over land
 *   - the height field is a number everywhere on a map's FIRST load (see the
 *     note on 'auto' elevations below)
 *   - every map's scenery and features build without throwing, and nothing
 *     they build stands on a runway
 *   - every town has buildings, and none of them stands on a helipad, a
 *     road or either approach lane; the streets a town is laid along are
 *     dry and off the airfield, and most buildings face a street
 *   - every field of farmland is dry, off both pads and off every road
 *   - tree vertex colours are linear (written as sRGB, they rendered mint)
 *   - every map a mission or a test names exists, and every retired map id
 *     resolves to a live map of the same game — through the real
 *     loadSettings()/saveSettings() round trip, not a mock of it
 *
 * and the three new maps get their own: Gateway's runway is long enough for
 * a 747 and an A380, its bridge spans the water clear of the approach
 * lanes, it has farmland and an airport estate; Northwatch is behind the
 * passcode, its hover pads are level, the Slot is 300-1200 m of water;
 * Condor Rock's strip ends at a cliff with nothing standing in either
 * overrun. All three: relief worth looking at (land-height standard
 * deviation over the main island of 8 m or more) and approach corridors that
 * cut no more than 2% of the land.
 *
 * Measured with this file, 2026-09-25/26, on the tree it was committed with:
 *   Gateway    runway 3,800 m x 60 m at 40 m; corridor cut 0.00%; land SD
 *              25.3 m; bridge 52.6 m under the deck; 80 fields; 7 sheds, 4
 *              car parks, 82 cars, 2 hotels; 89 draw calls (Northwatch 96,
 *              Condor 65: +1 each for the hospital's walls and sign)
 *   Northwatch corridor cut 0.00% (crosswind lane shortened: the default
 *              cut 82 m out of East Fell); land SD 20.9 m; Slot 840 m;
 *              120 fields
 *   Condor     corridor cut 1.21%, worst 19 m (crosswind stub moved west and
 *              its lane shrunk: the default cut 60 m out of the Beak); land
 *              SD 21.3 m; sea 260-270 m past both thresholds
 *   All maps   1,239 of 1,343 town buildings square to a street (92%); 82
 *              streets; 315 fields and 5,781 hedge lengths on 4 maps; no
 *              map's lanes cut more than 7.65% of its land (Fjord; the Rigs
 *              was 17.7%); 28 roof-pad buildings and rig modules solid at
 *              every corner (all 28 had half their width as air)
 *   Delta      the bars in 9 columns of 400 m (the ladder was 2); channel
 *              5.0 m at its shallowest (the harbour mouth), 29 marks; 64% of
 *              the water 150-600 m beside it under 4 m
 *
 * Also run against a trial merge of this branch into integrate/wishlist
 * (2026-09-26): 86/86 there too, after the Rigs was rebuilt — its glide lane
 * put the old Rigs at 10.9%.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/* ---- a page, as far as these modules need one ---- */
global.document = {
  createElement: () => ({
    getContext: () => new Proxy({}, { get: () => () => ({ addColorStop() {}, data: new Uint8ClampedArray(4) }) }),
    width: 0,
    height: 0,
    style: {},
  }),
  body: { appendChild() {} },
};
const store = new Map();
global.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};
// storage.js and extensions.js only touch `window` inside functions this
// file never calls, but a stub costs nothing.
global.window = global.window || { addEventListener() {} };

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const SRC = new URL('../../src/', import.meta.url).href;

const THREE = await import(SRC + 'vendor/three.module.js');
const T = await import(SRC + 'world/terrain.js');
const M = await import(SRC + 'world/maps.js');
const P = await import(SRC + 'world/pads.js');
const R = await import(SRC + 'world/roads.js');
const S = await import(SRC + 'world/scenery.js');
const F = await import(SRC + 'world/features.js');
const Store = await import(SRC + 'core/storage.js');
const Retired = await import(SRC + 'features/maps-retired.js');

const quiet = process.argv.includes('--quiet');
const results = [];
function ok(name, pass, detail = '') {
  results.push({ name, pass: !!pass, detail });
  if (!quiet || !pass) console.log(`${pass ? 'ok  ' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
}

const MAPS = M.MAPS;
const NEW = ['gateway', 'northwatch', 'condor'];

/* ================================================================== *
 * The roster
 * ================================================================== */

const ids = MAPS.map((m) => m.id);
ok('every map id is unique', new Set(ids).size === ids.length, `${ids.length} maps`);
const flight = M.mapsForGame('flight').map((m) => m.id);
// tests/selftest-three-games.js asserts exactly nine, and says why.
ok('the flight game still offers exactly nine maps', flight.length === 9, flight.join(' '));
for (const id of NEW) ok(`${id} is on the map list`, ids.includes(id));

/** Every map id named in the missions and the tests, read out of the source. */
function namedMapIds() {
  const named = new Map();
  const note = (id, where) => { if (!named.has(id)) named.set(id, where); };
  const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(dir, e.name)) : e.name.endsWith('.js') ? [join(dir, e.name)] : []);
  for (const f of walk(join(ROOT, 'src', 'game'))) {
    const s = readFileSync(f, 'utf8');
    for (const m of s.matchAll(/\bmap:\s*'([a-z0-9-]+)'/g)) note(m[1], f.slice(ROOT.length + 1));
  }
  for (const f of walk(join(ROOT, 'tests'))) {
    if (f.endsWith('maps.mjs')) continue;
    const s = readFileSync(f, 'utf8');
    for (const m of s.matchAll(/(?:getMap|goToMap|applyMap|setMap)\(\s*'([a-z0-9-]+)'/g)) note(m[1], f.slice(ROOT.length + 1));
    const nm = s.match(/NEW_MAPS\s*=\s*\[([^\]]*)\]/);
    if (nm) for (const m of nm[1].matchAll(/'([a-z0-9-]+)'/g)) note(m[1], f.slice(ROOT.length + 1));
  }
  return named;
}
const named = namedMapIds();
const missing = [...named].filter(([id]) => !ids.includes(id));
ok('every map a mission or a test names still exists', missing.length === 0 && named.size >= 9,
  missing.map(([id, f]) => `${id} (${f})`).join(', ') || `${named.size} named: ${[...named.keys()].join(' ')}`);

/* ================================================================== *
 * Retired maps, through the real save
 * ================================================================== */

const gameOf = (id) => (M.getMap(id).game || 'flight');
for (const [gone, next] of Object.entries(M.RETIRED_MAPS)) {
  ok(`retired '${gone}' is really gone`, !ids.includes(gone));
  ok(`retired '${gone}' resolves to a live map`, M.getMap(gone).id === next && ids.includes(next), `→ ${M.getMap(gone).id}`);
}
ok('the retired flight airports land on a flight map', ['sfo', 'oak', 'lax'].every((i) => gameOf(M.resolveMapId(i)) === 'flight'));
ok('the retired car maps land on a car map', ['airfieldperimeter', 'desertrun'].every((i) => gameOf(M.resolveMapId(i)) === 'car'));
ok('an id nobody ever had still falls back to Kestrel', M.getMap('no-such-map').id === 'kestrel' && M.resolveMapId(undefined) === 'kestrel');
{
  // A child last flew Los Angeles. Their browser holds exactly this.
  store.clear();
  localStorage.setItem('islandsim.settings.v1', JSON.stringify({ map: 'lax', quality: 'medium' }));
  const settings = Store.loadSettings();
  const sawRaw = settings.map;
  // What boot does first: applyMap(settings.map || 'kestrel').
  const built = T.applyMap(settings.map || 'kestrel');
  // Then, after boot, the plug-in's install().
  const synced = [];
  const sim = { settings, menus: { syncMap: (id) => synced.push(id) }, gameMap: { car: 'desertrun' }, mapBeforeMission: 'oak' };
  const did = Retired.settleSavedMap(sim);
  const again = Store.loadSettings();
  ok('a saved retired map loads the replacement island at boot', sawRaw === 'lax' && built.id === 'gateway', `saved 'lax', built '${built.id}'`);
  ok('…and the saved setting is rewritten, once, and stays rewritten',
    did && did.to === 'gateway' && again.map === 'gateway' && again.quality === 'medium',
    `reloaded settings.map = '${again.map}', quality kept = ${again.quality}`);
  ok('…and the menu is told which island it is actually on', synced.length === 1 && synced[0] === 'gateway', synced.join(','));
  ok('…and the per-game memory and a borrowed map are put right too',
    sim.gameMap.car === 'drovers' && sim.mapBeforeMission === 'gateway', `${sim.gameMap.car}, ${sim.mapBeforeMission}`);
  ok('…and a live saved map is left alone', Retired.settleSavedMap({ settings: { map: 'ember' } }) === null);
}

/* ================================================================== *
 * Every map
 * ================================================================== */

function boundsOf(map) {
  let x0 = Infinity; let x1 = -Infinity; let z0 = Infinity; let z1 = -Infinity;
  for (const c of map.chunks || []) {
    x0 = Math.min(x0, c.cx - c.size / 2); x1 = Math.max(x1, c.cx + c.size / 2);
    z0 = Math.min(z0, c.cz - c.size / 2); z1 = Math.max(z1, c.cz + c.size / 2);
  }
  return { x0, x1, z0, z1 };
}

function reliefSD(map) {
  const main = map.islands[0];
  const hs = [];
  const N = 48;
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const x = main.cx + (i / (N - 1) * 2 - 1) * main.radius * 0.85;
    const z = main.cz + (j / (N - 1) * 2 - 1) * main.radius * 0.85;
    if (Math.hypot(x - main.cx, z - main.cz) > main.radius * 0.85) continue;
    const h = T.heightAt(x, z);
    if (h > 1) hs.push(h);
  }
  const mean = hs.reduce((a, b) => a + b, 0) / Math.max(1, hs.length);
  return Math.sqrt(hs.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, hs.length));
}

/** Share of the land the approach corridors cut by more than a metre. */
function corridorCut(map) {
  const b = boundsOf(map);
  const G = 128;
  const withCut = new Float64Array(G * G);
  T.applyMap(map);
  for (let j = 0; j < G; j++) for (let i = 0; i < G; i++) {
    withCut[j * G + i] = T.heightAt(b.x0 + (b.x1 - b.x0) * i / (G - 1), b.z0 + (b.z1 - b.z0) * j / (G - 1));
  }
  T.applyMap({ ...map, corridor: { length: 0 }, corridor2: { length: 0 } });
  let land = 0; let cut = 0; let worst = 0;
  for (let j = 0; j < G; j++) for (let i = 0; i < G; i++) {
    const h0 = T.heightAt(b.x0 + (b.x1 - b.x0) * i / (G - 1), b.z0 + (b.z1 - b.z0) * j / (G - 1));
    if (h0 <= 0) continue;
    land++;
    const d = h0 - withCut[j * G + i];
    if (d > 1) { cut++; worst = Math.max(worst, d); }
  }
  T.applyMap(map);
  return { pct: (100 * cut) / Math.max(1, land), worst };
}

const faults = {
  finite: [], runway: [], spawn: [], harbour: [], shoalWet: [], shoalDry: [], places: [], roadOrder: [],
  lighthouse: [], pads: [], delivery: [], build: [], onRunway: [], town: [], townOnPad: [],
  unreachable: [], townOnRoad: [], townInLane: [], streets: [], fields: [], colour: [], padBuilding: [],
};
const layout = { towns: 0, faced: 0, total: 0, streets: 0, fieldMaps: 0, fields: 0, hedges: 0, padBuildings: 0 };

/** Squared distance from a point to a segment. */
function segDist2(px, pz, ax, az, bx, bz) {
  const dx = bx - ax;
  const dz = bz - az;
  const L2 = dx * dx + dz * dz;
  let t = L2 > 0 ? ((px - ax) * dx + (pz - az) * dz) / L2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return (ax + dx * t - px) ** 2 + (az + dz * t - pz) ** 2;
}

/** Inside either approach lane (the box scatter() keeps trees out of, for both runways). */
function inLane(x, z) {
  const A = T.AIRPORT;
  const rw = A.runway;
  if (Math.abs(x - rw.cx) < T.CORRIDOR.length && Math.abs(z - rw.cz) < T.CORRIDOR.halfWidth) return true;
  const r2 = A.runway2;
  if (!r2) return false;
  const alongX = Math.abs((((r2.headingDeg ?? 180) % 180) - 90)) < 45;
  const along = alongX ? Math.abs(x - r2.cx) : Math.abs(z - r2.cz);
  const across = alongX ? Math.abs(z - r2.cz) : Math.abs(x - r2.cx);
  return along < T.CORRIDOR2.length && across < T.CORRIDOR2.halfWidth;
}
let harbours = 0;
const built = {};

for (const map of MAPS) {
  /* First load. A map whose outpost or flat says elev: 'auto' and whose
     harbour is auto-sited measured its median ground through a harbour term
     that had no coordinates yet, got NaN, and levelled the strip to NaN —
     on the first load of the session only, so it looked fine on the second.
     Nothing on a map may be NaN the first time it is loaded. */
  T.applyMap(map);
  {
    const b = boundsOf(map);
    let bad = 0; let at = null;
    for (let j = 0; j < 64; j++) for (let i = 0; i < 64; i++) {
      const x = b.x0 + (b.x1 - b.x0) * i / 63;
      const z = b.z0 + (b.z1 - b.z0) * j / 63;
      if (!Number.isFinite(T.heightAt(x, z))) { bad++; at = at || [Math.round(x), Math.round(z)]; }
    }
    const o = map.outpost;
    if (o && !Number.isFinite(T.heightAt(o.cx, o.cz))) { bad++; at = at || [o.cx, o.cz]; }
    if (bad) faults.finite.push(`${map.id}: ${bad} NaN samples, first at ${at}`);
  }
  T.clearObstacles(); T.clearPlatforms(); P.clearPads();

  /* What boot does next (main.js layRoads): a courier map with no authored
     network gets the router's, written into map.waters.roads, and the height
     field is re-applied because a road cuts the ground. Everything below —
     the runway, the town, the fields — has to be measured on THAT ground, or
     this file is checking a map nobody ever drives on. Put back afterwards. */
  const hadRoads = map.waters && map.waters.roads;
  let roadNotes = [];
  let laidRoads = false;
  if (map.courier && !(hadRoads && hadRoads.length)) {
    const b = R.buildRoads(map);
    roadNotes = b.notes || [];
    map.waters = map.waters || {};
    map.waters.roads = b.roads;
    delete map.waters._ready;
    T.applyMap(map);
    T.clearObstacles(); T.clearPlatforms(); P.clearPads();
    laidRoads = true;
  }

  // Runways: at field elevation along the centreline and both edges.
  const A = T.AIRPORT;
  const strips = [[A.runway, A.headingDeg ?? 90], [A.runway2, A.runway2 && (A.runway2.headingDeg ?? 180)]];
  let worstRw = 0;
  for (const [r, hd] of strips) {
    if (!r) continue;
    const alongX = Math.abs(((hd % 180) - 90)) < 45;
    for (let s = -r.length / 2; s <= r.length / 2; s += 10) {
      for (const c of [-r.halfWidth, 0, r.halfWidth]) {
        const x = alongX ? r.cx + s : r.cx + c;
        const z = alongX ? r.cz + c : r.cz + s;
        worstRw = Math.max(worstRw, Math.abs(T.heightAt(x, z) - A.elev));
      }
    }
  }
  if (worstRw > 0.25) faults.runway.push(`${map.id}: ${worstRw.toFixed(2)} m off field elevation`);
  // The spawn: eighty metres in from the west threshold (missions.js RUNWAY_START).
  const sx = A.runway.cx - A.runway.length / 2 + 80;
  const sy = T.heightAt(sx, A.runway.cz);
  if (Math.abs(sy - A.elev) > 0.25 || !T.isOnRunway(sx, A.runway.cz)) faults.spawn.push(`${map.id}: ground ${sy.toFixed(1)} at spawn, field ${A.elev}`);

  // Harbours.
  const berth = T.harbourBerth();
  const mouth = T.harbourMouth();
  if (berth && mouth) {
    harbours++;
    const db = -T.heightAt(berth.x, berth.z) - 1;
    const dm = -T.heightAt(mouth.x, mouth.z) - 1;
    if (!(db >= 3 && dm >= 3)) faults.harbour.push(`${map.id}: ${db.toFixed(1)} m at the quay, ${dm.toFixed(1)} m at the mouth`);
  }

  // Shoals, both ways round.
  for (const s of (map.waters && map.waters.shoals) || []) {
    if (s.top > 0) continue;
    const h = T.heightAt(s.cx, s.cz);
    if (h > 0.5) faults.shoalWet.push(`${map.id}/${s.name || `${s.cx},${s.cz}`}: says ${(-s.top).toFixed(1)} m of water, stands ${h.toFixed(1)} m out`);
  }
  for (const s of T.dryingShoals()) {
    const h = T.heightAt(s.cx, s.cz);
    if (h <= -1.8) faults.shoalDry.push(`${map.id}/${s.name || `${s.cx},${s.cz}`}: drawn as breaking water, ${h.toFixed(1)} m down`);
  }

  // Roads: authored, or what the router built for the courier (above). The
  // [x, z, y] check is for the authored ones — somebody typed those.
  const roads = (map.waters && map.waters.roads) || [];
  for (const rd of laidRoads ? [] : roads) {
    for (const pt of rd.path) {
      if (T.padWeight(pt[0], pt[1]) > 0.9) continue;
      const off = Math.abs(T.heightAt(pt[0], pt[1]) - pt[2]);
      if (off > 8) faults.roadOrder.push(`${map.id}: [${pt.join(', ')}] is ${off.toFixed(1)} m off its own profile`);
    }
  }
  for (const p of (map.courier && map.courier.places) || []) {
    if (p.boatOnly) continue;
    if (T.heightAt(p.x, p.z) <= 0.5) continue;
    if (T.padWeight(p.x, p.z) > 0.5) continue;
    if (!R.onRoad(roads, p.x, p.z, 220)) faults.places.push(`${map.id}/${p.id}`);
  }
  /* Tarmac near every address is not the same as a way to get there: two
     roads can each pass a place and never meet. Roads that touch or cross
     are one network (union-find over every pair); every address with a road
     near it has to be on the SAME network as the depot. */
  if (map.courier && roads.length) {
    const parent = roads.map((_, i) => i);
    const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
    const touch = (a, b) => {
      const reach = ((a.halfWidth || 18) + (b.halfWidth || 18)) * 0.8 + 12;
      for (const p of a.path) {
        for (let k = 1; k < b.path.length; k++) {
          if (segDist2(p[0], p[1], b.path[k - 1][0], b.path[k - 1][1], b.path[k][0], b.path[k][1]) < reach * reach) return true;
        }
      }
      return false;
    };
    for (let i = 0; i < roads.length; i++) {
      for (let j = i + 1; j < roads.length; j++) if (find(i) !== find(j) && touch(roads[i], roads[j])) parent[find(i)] = find(j);
    }
    const netOf = (p) => {
      let best = null;
      let bd = 220 * 220;
      roads.forEach((r, i) => {
        for (let k = 1; k < r.path.length; k++) {
          const d2 = segDist2(p.x, p.z, r.path[k - 1][0], r.path[k - 1][1], r.path[k][0], r.path[k][1]);
          if (d2 < bd) { bd = d2; best = find(i); }
        }
      });
      return best;
    };
    const places = map.courier.places.filter((p) => !p.boatOnly && T.heightAt(p.x, p.z) > 0.5);
    const depot = places.find((p) => p.id === map.courier.depot) || places[0];
    const home = depot ? netOf(depot) : null;
    for (const p of places) {
      const n = netOf(p);
      if (n !== null && home !== null && n !== home) faults.unreachable.push(`${map.id}/${p.id}`);
    }
    for (const note of roadNotes) if (/no road can reach/.test(note)) faults.unreachable.push(`${map.id}: ${note}`);
  }

  // Lighthouse: the coordinate as written.
  const sc = map.scenery || {};
  if (sc.lighthouse) {
    const h = T.heightAt(sc.lighthouse[0], sc.lighthouse[1]);
    if (h < 2) faults.lighthouse.push(`${map.id}: [${sc.lighthouse}] is ${h.toFixed(1)} m`);
  }
  // Pads that are not ship decks stand on land.
  for (const p of P.padsOf(map)) {
    if (p.kind === 'deck') continue;
    const h = T.heightAt(p.x, p.z);
    if (h <= 0.5) faults.pads.push(`${map.id}/${p.id}: ${h.toFixed(1)} m`);
  }
  if (sc.deliveryPad) {
    const h = T.heightAt(sc.deliveryPad[0], sc.deliveryPad[1]);
    if (h < 1) faults.delivery.push(`${map.id}: delivery pad at ${h.toFixed(1)} m`);
  }

  // The town, as the builder plans it.
  if (sc.town) {
    const plan = S.planTown(sc.town, 1);
    if (!plan.spots.length) faults.town.push(`${map.id}: no buildings`);
    for (const p of P.padsOf(map)) {
      const clear = p.kind === 'roof' ? (p.r || 11) * 1.25 + 12 : (p.r || 11) + 16;
      const on = plan.spots.filter((s) => Math.hypot(s.x - p.x, s.z - p.z) <= clear).length;
      if (on) faults.townOnPad.push(`${map.id}/${p.id}: ${on}`);
    }
  }

  /* The town's layout: nothing on a road or in an approach lane, streets on
     dry ground and off the pads, and — where the town was laid along
     streets — the houses square to the street they front. */
  if (sc.town) {
    const plan = S.planTown(sc.town, 1);
    const rs = (map.waters && map.waters.roads) || [];
    const segs = [];
    for (const r of rs) for (let k = 1; k < r.path.length; k++) segs.push([r.path[k - 1][0], r.path[k - 1][1], r.path[k][0], r.path[k][1]]);
    for (const st of plan.streets || []) for (let k = 1; k < st.pts.length; k++) segs.push([st.pts[k - 1][0], st.pts[k - 1][1], st.pts[k][0], st.pts[k][1]]);
    const onARoad = (x, z) => rs.some((r) => {
      for (let k = 1; k < r.path.length; k++) {
        if (segDist2(x, z, r.path[k - 1][0], r.path[k - 1][1], r.path[k][0], r.path[k][1]) < (r.halfWidth || 18) ** 2) return true;
      }
      return false;
    });
    let onRoadN = 0;
    let inLaneN = 0;
    for (const b of plan.spots) {
      if (onARoad(b.x, b.z)) onRoadN++;
      if (inLane(b.x, b.z)) inLaneN++;
      // Facing: the nearest street or road within 40 m, and the building's
      // own axis within 8 degrees of it (either way round).
      let best = 40 * 40;
      let dir = null;
      for (const [ax, az, bx, bz] of segs) {
        const d2 = segDist2(b.x, b.z, ax, az, bx, bz);
        if (d2 < best) { best = d2; dir = Math.atan2(-(bz - az), bx - ax); }
      }
      if (segs.length) {
        layout.total++;
        if (dir !== null) {
          let a = Math.abs((b.rot - dir) % Math.PI);
          a = Math.min(a, Math.PI - a);
          if (a < (8 * Math.PI) / 180) layout.faced++;
        }
      }
    }
    if (onRoadN) faults.townOnRoad.push(`${map.id}: ${onRoadN}`);
    if (inLaneN) faults.townInLane.push(`${map.id}: ${inLaneN}`);
    for (const st of plan.streets || []) {
      const bad = st.pts.filter(([x, z]) => T.heightAt(x, z) < 2 || T.padWeight(x, z) > 0).length;
      if (bad) faults.streets.push(`${map.id}: ${bad} street points wet or on the airfield`);
      layout.streets++;
    }
    layout.towns++;
  }

  // Build it: scenery and features, as buildWorld does, and look at what
  // they registered as solid.
  try {
    const scene = new THREE.Scene();
    const scenery = new S.Scenery(scene, 'high');
    const features = new F.MapFeatures(scene, 'high');
    scenery.update(0.5, { isNight: true, cond: { cloud: 0, turb: 0 }, time: 'night' });
    features.update(0.5, { isNight: true, time: 'night', windVector: (v) => v.set(2, 0, 1) });
    let draws = 0;
    scene.traverse((o) => { if (o.isMesh || o.isPoints) draws++; });
    /* Farmland: every field vertex on dry land, off both pads and off every
       road. */
    const fm = features.group.getObjectByName('fields');
    if (fm) {
      layout.fieldMaps++;
      layout.fields += features.fields ? features.fields.count : 0;
      layout.hedges += features.fields ? features.fields.hedges || 0 : 0;
      const p = fm.geometry.attributes.position;
      const rs = (map.waters && map.waters.roads) || [];
      let bad = 0;
      for (let i = 0; i < p.count; i++) {
        const x = p.getX(i);
        const z = p.getZ(i);
        if (T.heightAt(x, z) < 3 || T.padWeight(x, z) > 0) { bad++; continue; }
        if (rs.some((r) => r.path.some((q) => (q[0] - x) ** 2 + (q[1] - z) ** 2 < (r.halfWidth || 18) ** 2))) bad++;
      }
      if (bad) faults.fields.push(`${map.id}: ${bad} of ${p.count} field vertices wet, on a pad or on a road`);
    }
    /* Vertex colours are linear. Written as sRGB and read as linear, every
       wood in the game rendered mint (see linearRGB in scenery.js); a
       palm-frond green holds under 0.3 in its green channel once converted,
       and a mean green over 0.35 across a tree mesh means it went in raw. */
    scenery.group.traverse((o) => {
      // Trees only: the hospital signs are vertex-coloured too, and unlit.
      if (!o.isInstancedMesh || !o.material.vertexColors || o.material.map || o.material.isMeshBasicMaterial) return;
      const c = o.geometry.attributes.color;
      if (!c) return;
      let g = 0;
      for (let i = 0; i < c.count; i++) g += c.getY(i);
      if (g / c.count > 0.35) faults.colour.push(`${map.id}: a tree mesh averages ${(g / c.count).toFixed(2)} green`);
    });
    /* A roof pad's building and a rig's plant module are solid across all
       of what is drawn. Both registered half their drawn width (a 27.5 m
       hospital was solid across the middle 13.75 m). Probed 10% in from
       every corner, 3 m up. */
    for (const pd of P.PADS) {
      if (pd.kind !== 'roof' && pd.kind !== 'deck') continue;
      const w = pd.kind === 'roof' ? pd.r * 1.25 : pd.r * 1.1;
      const cz = pd.kind === 'roof' ? pd.pos.z : pd.pos.z + pd.r * 1.1;
      const y = pd.kind === 'roof' ? pd.ground + 3 : pd.pos.y - 6;
      const air = [[-1, -1], [1, -1], [-1, 1], [1, 1]].filter(([sx, sz]) => !T.obstacleAt(pd.pos.x + sx * w * 0.9, y, cz + sz * w * 0.9));
      if (air.length) faults.padBuilding.push(`${map.id}/${pd.id}: ${air.length} of 4 corners are air`);
      layout.padBuildings++;
    }
    built[map.id] = { scenery, features, draws, pads: P.PADS.map((p) => ({ ...p, pos: p.pos.clone() })), obstacles: T.OBSTACLES.length };
    for (const [r, hd] of strips) {
      if (!r) continue;
      const alongX = Math.abs(((hd % 180) - 90)) < 45;
      const hx = (alongX ? r.length / 2 : r.halfWidth) + 5;
      const hz = (alongX ? r.halfWidth : r.length / 2) + 5;
      const hit = T.OBSTACLES.find((o) => o.y1 > A.elev + 0.5
        && o.x1 >= r.cx - hx && o.x0 <= r.cx + hx && o.z1 >= r.cz - hz && o.z0 <= r.cz + hz);
      if (hit) faults.onRunway.push(`${map.id}: ${hit.what} at ${((hit.x0 + hit.x1) / 2).toFixed(0)},${((hit.z0 + hit.z1) / 2).toFixed(0)}`);
    }
  } catch (err) {
    faults.build.push(`${map.id}: ${err && err.message}`);
  }
  T.clearObstacles(); T.clearPlatforms(); P.clearPads();
  if (laidRoads) {
    if (hadRoads) map.waters.roads = hadRoads;
    else delete map.waters.roads;
    delete map.waters._ready;
  }
}

const show = (list, all) => list.slice(0, 4).join('; ') || all;
ok('the height field is a number everywhere on every map, on its first load', !faults.finite.length, show(faults.finite, `${MAPS.length} maps`));
ok('every runway is at field elevation along its whole length', !faults.runway.length, show(faults.runway, 'all within 0.25 m'));
ok('every map spawns the aeroplane on its runway', !faults.spawn.length, show(faults.spawn, 'all on the tarmac'));
ok('every harbour has 3 m under the keel at the quay and the mouth', !faults.harbour.length && harbours >= 12, show(faults.harbour, `${harbours} harbours`));
ok('every shoal that declares water is in the water', !faults.shoalWet.length, show(faults.shoalWet, 'all wet'));
ok('every shoal drawn as breaking water really dries', !faults.shoalDry.length, show(faults.shoalDry, 'all shallow'));
ok('every authored road point is [x, z, y]', !faults.roadOrder.length, show(faults.roadOrder, 'all within 8 m of their own profile'));
ok('every courier place has tarmac within 220 m', !faults.places.length, show(faults.places, 'none stranded'));
ok('every lighthouse coordinate is on land as written', !faults.lighthouse.length, show(faults.lighthouse, 'all 2 m or more above the sea'));
ok('every helipad that is not a ship deck is over land', !faults.pads.length, show(faults.pads, 'all on land'));
ok('every delivery pad is on land', !faults.delivery.length, show(faults.delivery, 'all on land'));
ok('every map builds its scenery and features without throwing', !faults.build.length, show(faults.build, `${Object.keys(built).length} built`));
ok('nothing the scenery builds stands on a runway', !faults.onRunway.length, show(faults.onRunway, 'runways clear'));
ok('every town has buildings in it', !faults.town.length, show(faults.town, 'none empty'));
ok('no town building stands on a helipad', !faults.townOnPad.length, show(faults.townOnPad, 'pads clear'));
ok('every courier address is on the same road network as the depot', !faults.unreachable.length, show(faults.unreachable, 'all joined'));
ok('no town building stands on a road', !faults.townOnRoad.length, show(faults.townOnRoad, 'roads clear'));
ok('no town building stands in an approach lane (either runway)', !faults.townInLane.length, show(faults.townInLane, 'lanes clear'));
ok('every street a town is laid along is on dry ground, off the airfield', !faults.streets.length && layout.streets > 0,
  show(faults.streets, `${layout.streets} streets on ${layout.towns} towns`));
ok('most town buildings face a street (within 8 degrees)', layout.total > 0 && layout.faced / layout.total >= 0.7,
  `${layout.faced} of ${layout.total} (${((100 * layout.faced) / Math.max(1, layout.total)).toFixed(0)}%)`);
ok('every field is on dry land, off the pads and off the roads', !faults.fields.length && layout.fieldMaps >= 4,
  show(faults.fields, `${layout.fields} fields and ${layout.hedges} hedge lengths on ${layout.fieldMaps} maps`));
ok('tree vertex colours are linear, not raw sRGB', !faults.colour.length, show(faults.colour, 'all converted'));
ok('every hospital, roof-pad building and rig module is solid where it is drawn', !faults.padBuilding.length && layout.padBuildings > 10,
  show(faults.padBuilding, `${layout.padBuildings} buildings, every corner solid`));

/* ================================================================== *
 * The new maps
 * ================================================================== */

for (const id of NEW) {
  const map = M.getMap(id);
  T.applyMap(map);
  const sd = reliefSD(map);
  const cut = corridorCut(map);
  ok(`${id}: relief worth looking at (land SD ≥ 8 m)`, sd >= 8, `${sd.toFixed(1)} m`);
  ok(`${id}: the approach corridors cut ≤ 2% of the land`, cut.pct <= 2, `${cut.pct.toFixed(2)}%, worst ${cut.worst.toFixed(0)} m`);
  const verts = map.chunks.reduce((n, c) => n + (c.segments + 1) ** 2, 0);
  ok(`${id}: terrain mesh within the budget (≤ 120k vertices at 'high')`, verts <= 120000, `${(verts / 1000).toFixed(1)}k`);
  const b = built[id];
  ok(`${id}: fewer than 100 draw calls of scenery and features`, b && b.draws < 100, b ? `${b.draws}` : 'not built');
}

/*
 * The Delta, which was a ladder: eight bars at x = +-1550, thirteen shoals
 * in two lines at x = +-900, and a harbour facing away from all of it. Now
 * a fan with one buoyed channel down it — so: the bars are spread across
 * the fan (their x positions fall in more than four 400 m columns; the
 * ladder was two), the channel is deep all the way out, and the water
 * beside it is shoal water, or the channel is just a line of buoys.
 */
{
  const map = M.getMap('delta');
  T.applyMap(map);
  const cols = new Set(map.islands.slice(2).map((i) => Math.round(i.cx / 400)));
  ok('delta: the bars fan out, not two columns', cols.size > 4, `${cols.size} columns of 400 m`);
  const P = (map.waters.channel && map.waters.channel.path) || [];
  let shallowest = Infinity;
  let beside = 0;
  let shoalWater = 0;
  for (let i = 1; i < P.length; i++) {
    const [ax, az] = P[i - 1];
    const [bx, bz] = P[i];
    const L = Math.hypot(bx - ax, bz - az);
    const ix = (bx - ax) / L;
    const iz = (bz - az) / L;
    for (let d = 0; d <= L; d += 20) {
      shallowest = Math.min(shallowest, -T.heightAt(ax + ix * d, az + iz * d));
      // Beside it, clear of the harbour at the top of the river.
      if (i < 3 || d % 40) continue;
      for (const off of [150, 250, 350, 450, 600]) for (const sg of [-1, 1]) {
        const h = T.heightAt(ax + ix * d - iz * off * sg, az + iz * d + ix * off * sg);
        if (h >= 0) continue;
        beside++;
        if (h > -4) shoalWater++;
      }
    }
  }
  const marks = T.channelMarks().length;
  ok('delta: the buoyed channel is at least 4 m deep from the harbour mouth to the fairway',
    P.length > 5 && shallowest >= 4 && marks >= 20, `shallowest ${shallowest.toFixed(1)} m, ${marks} marks`);
  ok('delta: beside the channel is shoal water (half or more under 4 m)', beside > 0 && shoalWater / beside >= 0.5,
    `${((100 * shoalWater) / Math.max(1, beside)).toFixed(0)}% of ${beside} samples 150-600 m off the channel`);
  T.applyMap(M.getMap('kestrel'));
}

/*
 * And no map anywhere gets its cross back. Measured 2026-09-26 over all
 * thirty: the Rigs was 17.7% (it borrows Kestrel's two runways, and the
 * crosswind lane was a 100 m trench through the head); Fjord's 7.7% is its
 * valley floor and is the price of a strip in a fjord.
 */
{
  const worst = [];
  let top = { id: '', pct: 0 };
  for (const map of MAPS) {
    const c = corridorCut(map);
    if (c.pct > top.pct) top = { id: map.id, pct: c.pct };
    if (c.pct > 8) worst.push(`${map.id} ${c.pct.toFixed(1)}%`);
  }
  T.applyMap(M.getMap('kestrel'));
  ok('no map has more than 8% of its land cut by the approach corridors', !worst.length,
    worst.join(', ') || `highest ${top.id} ${top.pct.toFixed(2)}%`);
}

{
  const map = M.getMap('gateway');
  T.applyMap(map);
  const r = map.airport.runway;
  ok('gateway: the runway is long enough for the 747 and the A380 (≥ 3,500 m)', r.length >= 3500 && r.halfWidth >= 30, `${r.length} m x ${r.halfWidth * 2} m`);
  const f = built.gateway && built.gateway.features.bridge;
  ok('gateway: the bridge is built and spans water', !!f && f.water[1] - f.water[0] > 500, f ? `water ${f.water.join('..')}, towers ${f.towers.map(Math.round).join(', ')}` : 'no bridge');
  ok('gateway: you can fly under it (≥ 45 m to the deck)', !!f && f.clearance >= 45, f ? `${f.clearance.toFixed(1)} m` : '');
  // Clear of the main approach lane (|z| < 860 m at the widest) and not in
  // the crosswind strip's line either.
  ok('gateway: the bridge is clear of both approach lanes', !!f
    && Math.min(Math.abs(f.anchorages[0] - r.cz), Math.abs(f.anchorages[1] - r.cz)) > 1500
    && Math.abs(f.x - map.airport.runway2.cx) > 900, f ? `x ${f.x}, nearest end ${Math.round(Math.min(Math.abs(f.anchorages[0]), Math.abs(f.anchorages[1])))} m from the centreline` : '');
  const t = built.gateway && built.gateway.scenery.town;
  ok('gateway: the city has towers', !!t && t.towers >= 12 && t.tallest >= 120, t ? `${t.towers} towers, tallest ${t.tallest.toFixed(0)} m` : '');
  const e = built.gateway && built.gateway.scenery.estate;
  ok('gateway: the airport has its warehouses, car parks and hotels', !!e && e.sheds >= 5 && e.parks >= 2 && e.hotels >= 1,
    e ? `${e.sheds} sheds, ${e.parks} car parks, ${e.cars} cars, ${e.hotels} hotels` : 'none');
  const gf = built.gateway && built.gateway.features.fields;
  ok('gateway: farmland round the airport', !!gf && gf.count >= 30, gf ? `${gf.count} fields, ${gf.hedges} hedge lengths` : 'none');
}

{
  const map = M.getMap('northwatch');
  ok('northwatch: behind the military passcode like Ironhead', map.military === true);
  const b = built.northwatch;
  const hov = b ? b.pads.filter((p) => p.id.startsWith('hover')) : [];
  ok('northwatch: two hover pads, both level with the field',
    hov.length === 2 && hov.every((p) => Math.abs(p.pos.y - map.airport.elev) < 0.3),
    hov.map((p) => `${p.id} ${p.pos.y.toFixed(1)} m`).join(', '));
  T.applyMap(map);
  const c = map.carrier;
  const wet = [[0, 0], [0, -160], [0, 160], [-40, 0], [40, 0]].every(([dx, dz]) => T.heightAt(c.x + dx, c.z + dz) <= -12);
  ok('northwatch: the carrier berth is deep water under the whole deck', wet, `${c.x},${c.z}`);
  ok('northwatch: the air base is built', !!(b && b.scenery.base && b.scenery.base.parkSpots.length >= 4));
  const nf = b && b.features.fields;
  ok('northwatch: pasture on the plain', !!nf && nf.count >= 25, nf ? `${nf.count} fields, ${nf.hedges} hedge lengths` : 'none');
  // The Slot: open water between the two fells, wide enough to fly a jet
  // through and narrow enough to be worth doing. Measured along z = -3400.
  T.applyMap(map);
  let w0 = null;
  let w1 = null;
  for (let x = -1500; x <= 1500; x += 10) {
    if (T.heightAt(x, -3400) < 0) { if (w0 === null) w0 = x; w1 = x; }
  }
  const slot = w0 === null ? 0 : w1 - w0;
  ok('northwatch: the Slot is open water 300-1200 m wide between the fells', slot >= 300 && slot <= 1200, `${slot} m at z = -3400`);
}

{
  const map = M.getMap('condor');
  T.applyMap(map);
  const r = map.airport.runway;
  const e = map.airport.elev;
  const west = r.cx - r.length / 2;
  const east = r.cx + r.length / 2;
  // Nothing above the field in the first 200 m past either threshold, and
  // the sea within 400 m: the cliff is the point of the map.
  let over = -Infinity;
  for (let d = 10; d <= 200; d += 10) for (const z of [-40, 0, 40]) over = Math.max(over, T.heightAt(west - d, r.cz + z), T.heightAt(east + d, r.cz + z));
  const seaW = [...Array(40)].findIndex((_, i) => T.heightAt(west - 10 - i * 10, r.cz) < 0);
  const seaE = [...Array(40)].findIndex((_, i) => T.heightAt(east + 10 + i * 10, r.cz) < 0);
  ok('condor: nothing stands above the strip in either overrun', over <= e + 1, `highest ${over.toFixed(1)} m against a field of ${e} m`);
  ok('condor: the sea is within 400 m past both thresholds', seaW >= 0 && seaE >= 0,
    `${seaW >= 0 ? 10 + seaW * 10 : '>400'} m west, ${seaE >= 0 ? 10 + seaE * 10 : '>400'} m east`);
  const birds = built.condor && built.condor.features.flocks[0];
  ok('condor: the gulls are there', !!birds && birds.n >= 12, birds ? `${birds.n}` : 'none');
}

{
  // Cutter Bay: the harbour its card describes is built, and its breakwater
  // is a wall a boat cannot steam through, not seven rocks in a row.
  const map = M.getMap('harbour');
  T.applyMap(map);
  const links = map.scenery.harbour.breakwater.links;
  let deepest = Infinity;
  for (let i = 1; i < links.length; i++) {
    const [ax, az] = links[i - 1];
    const [bx, bz] = links[i];
    for (let t = 0; t <= 1; t += 0.02) deepest = Math.min(deepest, T.heightAt(ax + (bx - ax) * t, az + (bz - az) * t));
  }
  ok('harbour: the breakwater is continuous (grounds a 1 m keel all along it)', deepest > -1, `deepest point ${deepest.toFixed(2)} m`);
  const hd = built.harbour && built.harbour.scenery.harbourDressing;
  ok('harbour: the breakwater, moorings, fleet and fuel jetty are built',
    !!hd && hd.links >= 2 && hd.moorings >= 5 && hd.boats >= 6 && hd.jetty,
    hd ? `${hd.links} links, ${hd.moorings} moorings, ${hd.boats} boats, jetty ${hd.jetty}` : 'nothing built');
}

{
  // Palms belong in the tropics. Every map says what its climate is, and the
  // cold ones grow no palms at all.
  const cold = MAPS.filter((m) => m.scenery && ['boreal', 'temperate'].includes(m.scenery.flora));
  const palms = cold.filter((m) => {
    const f = S.floraOf(m);
    return f.coast[0] + f.hill[0] + f.pad[0] > 0;
  });
  ok('every map says what grows on it', MAPS.every((m) => m.scenery && S.FLORA[m.scenery.flora]),
    MAPS.filter((m) => !(m.scenery && S.FLORA[m.scenery.flora])).map((m) => m.id).join(', ') || `${MAPS.length} maps`);
  ok('no palm trees on a cold map', palms.length === 0, palms.map((m) => m.id).join(', ') || `${cold.length} cold or temperate maps`);
}

/* ================================================================== *
 * The cost of a sample
 * ================================================================== */
{
  /*
   * Best of three passes over the map's own chunk square. A sample costs
   * what the islands under it cost — three fbm calls per island whose field
   * reaches the point — so the fair comparison is with the dearest map the
   * game already ships, not with little Kestrel. Measured 2026-09-24, best of
   * five, a loaded laptop: Kestrel 0.9 us, Ember 1.8, Meadow 2.7, Fjord 2.6,
   * Atoll 2.9, Ironhead 5.4; Gateway 2.7, Condor 4.2, Northwatch 5.9.
   */
  const time = (id) => {
    const map = M.getMap(id);
    T.applyMap(map);
    const b = boundsOf(map);
    const G = 128;
    let best = Infinity;
    let sink = 0;
    // CPU time, not wall time, and the best of five: on a machine running
    // other builds this process gets paused mid-pass, and a wall clock then
    // measured a 36 us sample on a map whose samples cost 0.7 us.
    for (let k = 0; k < 5; k++) {
      const c0 = process.cpuUsage();
      for (let j = 0; j < G; j++) for (let i = 0; i < G; i++) sink += T.heightAt(b.x0 + (b.x1 - b.x0) * i / (G - 1), b.z0 + (b.z1 - b.z0) * j / (G - 1));
      const c = process.cpuUsage(c0);
      best = Math.min(best, ((c.user + c.system) * 1000) / (G * G));
    }
    return { ns: best, sink };
  };
  const shipped = ['kestrel', 'meadow', 'atoll', 'fjord', 'ember', 'airbase'].map((id) => ({ id, ns: time(id).ns }));
  const dearest = shipped.reduce((a, b) => (b.ns > a.ns ? b : a));
  for (const id of NEW) {
    const t = time(id).ns;
    // Loose on purpose: a laptop running three other things is not a
    // benchmark. What this catches is a term with no bounding-box reject,
    // which costs several times over, not a few per cent.
    ok(`${id}: a height sample costs no more than 1.5x the dearest shipped flight map`, t <= dearest.ns * 1.5,
      `${t.toFixed(0)} ns against ${dearest.id} ${dearest.ns.toFixed(0)} ns`);
  }
}

const failed = results.filter((r) => !r.pass);
console.log(`\nmaps: ${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);

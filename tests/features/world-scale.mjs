/**
 * How big things are, checked in node: `node tests/features/world-scale.mjs`.
 *
 * The owner, 2026-10-04: "sizing for everything is werid, houses are like
 * 200 ft tall according to the game". Measured on all thirty maps at v57
 * (458a307), in a headless Chrome, by the bounding boxes of what is drawn:
 *
 *   - the houses were half as tall again as real ones: eaves 7.0 m and ridge
 *     11.9 m at the median (a real two-storey house: 5-6 m and 7-9 m), up to
 *     15.8 m; a village's blocks up to 25 m round a square of houses
 *   - Kestrel's control tower, on a field with an 1,100 m runway, 75 m to
 *     the top of its cab; the hubs' 98 m
 *   - and the panel's ALTITUDE counts from the sea, while the towns stand 16
 *     to 318 m above it: level with the ridge of a Kestrel house (32 ft) it
 *     read "180 ft · just off the ground", which is a 180 ft house
 *
 * So, per family, the typical size range — from the builders' own
 * parameters (TOWN_SIZES, each map's tree heights, the airfield templates)
 * and from what they build on every map:
 *
 *   house     eaves 3-6 m, ridge 4.5-11 m (map median 6.5-9.5), footprint
 *             7-15 m, the collision box the drawn roof + 0.5 m, the door's
 *             hood under the eaves
 *   block     a village's no taller than 17 m to its roof slab; downtown's
 *             (maps with towers) 12-60 m, office blocks
 *   tower     downtown's 50-260 m to the top
 *   roof pad  the hospital and the city roofs 10-160 m up, a hospital no
 *             taller than an office block (40 m); the building under each
 *             pad solid to 1.6 m below it and the platform ON it (one
 *             source, pads.js `above`): a pad moves with its building
 *   tree      2-32 m, a map's median 3.5-22 m (scrub apart)
 *   car       3.8-5.2 m long, 1.2-1.9 m tall
 *   hangar    8-35 m to the eaves, doors 5-30 m, solid no higher than 45 m
 *   tower     15-80 m to the top of the cab (control towers)
 *   terminal  6-28 m to the eaves (a clubhouse 8, a hub 26), solid to 34
 *   mast      floodlight masts 10-35 m
 *   estate    warehouses 8-22 m to the roof, hotels 18-55 m
 *   runway    18-70 m wide (a club strip 24, a hub 68)
 *   road      two lanes and shoulders: 7-11 m of tarmac
 *   person    1.6-1.95 m
 *   vehicles  the airport's tug (with its tow bar), trucks, carts and cars,
 *             and the drivable van, each the length and height of the real
 *             thing
 *   aircraft  each drawn plan (nose to tail, tip to tip) within 0.6-1.5 of
 *             its real counterpart, the trainer within 15% of a Cessna 172;
 *             the made-up Air Massimo and the T-Pose joke are printed, not held
 *
 * and the altitude line's height over the ground, which is what a roof is
 * read against now (src/ui/hud.js).
 *
 * Measured in a headless Chrome on all thirty maps (v62, scratchpad
 * world-scale/table.md): houses eaves 5.3 m / ridge 8.3 m at the median,
 * village blocks 8-17 m, downtown blocks 23-45 m and towers 78-202 m,
 * terminals 17-32 m to the top, hangars 14-43 m, control towers 21-76 m,
 * masts 12-30 m, trees 2.5-25 m (medians 9.5-15 by species), cars 4.4 x
 * 1.4 m, runways 24-68 m wide, the towns 21-318 m above the sea.
 *
 * The carrier is five times a real one on purpose (src/world/carrier.js,
 * 2026-09-11, "way too small" at 300 m) and is reported here, not held to
 * a range. The Nightjar is a 0.64-scale B-2 on purpose (types.js) and is
 * held to the loose factor like the rest, with its ratio printed.
 *
 * Exits non-zero on any failure.
 */

import { readFileSync } from 'node:fs';

global.document = {
  createElement: () => ({
    getContext: () => new Proxy({}, { get: () => () => ({ addColorStop() {}, data: new Uint8ClampedArray(4) }) }),
    width: 0,
    height: 0,
    style: {},
  }),
  body: { appendChild() {} },
  head: { appendChild() {} },
};
const store = new Map();
global.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
global.window = global.window || { addEventListener() {}, devicePixelRatio: 1 };

const SRC = new URL('../../src/', import.meta.url).href;
const THREE = await import(SRC + 'vendor/three.module.js');
const T = await import(SRC + 'world/terrain.js');
const M = await import(SRC + 'world/maps.js');
const P = await import(SRC + 'world/pads.js');
const R = await import(SRC + 'world/roads.js');
const S = await import(SRC + 'world/scenery.js');
const AP = await import(SRC + 'world/airport.js');
const APR = await import(SRC + 'world/apron.js');
const C = await import(SRC + 'world/carrier.js');
const PER = await import(SRC + 'features/staff/person.js');
const HUD = await import(SRC + 'ui/hud.js');

const results = [];
function ok(name, pass, detail = '') {
  results.push({ name, pass: !!pass, detail: String(detail) });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
}
const median = (a) => {
  if (!a.length) return NaN;
  const b = a.slice().sort((x, y) => x - y);
  return b[Math.floor(b.length / 2)];
};
const span = (a) => (a.length ? `${Math.min(...a).toFixed(1)}-${Math.max(...a).toFixed(1)} m (median ${median(a).toFixed(1)})` : 'none');

/* ------------------------------------------------------------------ */
/* The builders' own parameters                                         */
/* ------------------------------------------------------------------ */

const HS = S.TOWN_SIZES.house;
const BS = S.TOWN_SIZES.block;
{
  const eaves = [];
  for (let i = 0; i < 1000; i++) eaves.push(S.houseEaves(i / 1000));
  ok('house eaves, every draw: 3-6 m, the median a two-storey house\'s 4.5-6',
    Math.min(...eaves) >= 3 && Math.max(...eaves) <= 6 && median(eaves) >= 4.5 && median(eaves) <= 6, span(eaves));
  // Ridge = eaves + rise + slab, over the whole range of spans and pitches.
  const ridges = [];
  const shortSides = [Math.min(HS.width[0], HS.depth[0]), Math.min(HS.width[1], HS.depth[1])];
  for (const e of [S.houseEaves(0), S.houseEaves(0.999)]) for (const sp of shortSides) for (const q of [0, 1]) ridges.push(e + S.houseRoofRise(sp, q) + 0.18);
  const typical = S.houseEaves(0.5) + S.houseRoofRise((shortSides[0] + shortSides[1]) / 2, 0.5) + 0.18;
  ok('house ridge from the parameters: 4.5-11 m at the extremes, 7-9 m for the typical house',
    Math.min(...ridges) >= 4.5 && Math.max(...ridges) <= 11 && typical >= 7 && typical <= 9, `${span(ridges)}; typical ${typical.toFixed(1)} m`);
  const pitchDeg = HS.pitch.map((f) => (Math.atan(2 * f) * 180) / Math.PI);
  ok('roof pitch 20-45 degrees', pitchDeg[0] >= 20 && pitchDeg[1] <= 45, pitchDeg.map((d) => d.toFixed(0)).join('-') + ' degrees');
  ok('house footprint 7-15 m each way', Math.min(...HS.width, ...HS.depth) >= 7 && Math.max(...HS.width, ...HS.depth) <= 15, `${HS.width.join('-')} x ${HS.depth.join('-')} m`);
  ok('a village block\'s eaves at most 16 m (four storeys and one on the square)', BS.village[1] + BS.villageSquare <= 16, `${BS.village[0]}-${BS.village[1] + BS.villageSquare} m`);
  // Trees: each map's nominal heights x scatter's 0.75-1.35 x the tallest species (1.15).
  const nominal = [];
  for (const m of M.MAPS) {
    const sc = m.scenery || {};
    for (const h of [sc.coastTreeHeight ?? 10, sc.hillTreeHeight ?? 11]) nominal.push(h);
  }
  ok('every map\'s tree heights, at the extremes of the scatter, 3-32 m', Math.min(...nominal) * 0.75 * 0.42 >= 1 && Math.max(...nominal) * 1.35 * 1.15 <= 32 && Math.min(...nominal) * 0.75 >= 3,
    `nominal ${Math.min(...nominal)}-${Math.max(...nominal)} m`);
}

/* ------------------------------------------------------------------ */
/* What is built, on every map                                          */
/* ------------------------------------------------------------------ */

const faults = { ridge: [], eaves: [], top: [], mesh: [], hood: [], block: [], tree: [], car: [], hangar: [], tower: [], footprint: [], terminal: [], flood: [], estate: [], skyline: [], roofPad: [], runway: [] };
const all = { eaves: [], ridge: [], mapRidge: [], tree: [], car: [], carH: [], hangarH: [], door: [], tower: [], block: [], terminal: [], terminalTop: [], flood: [], shed: [], hotel: [], skyline: [], cityBlock: [], roofPad: [], rwyW: [], townGround: [] };
let houses = 0;
let carrier = null;

for (const map of M.MAPS) {
  T.applyMap(map);
  T.clearObstacles();
  T.clearPlatforms();
  P.clearPads();
  if (map.courier && !(map.waters && map.waters.roads && map.waters.roads.length)) {
    const b = R.buildRoads(map);
    map.waters = map.waters || {};
    map.waters.roads = b.roads;
    delete map.waters._ready;
    T.applyMap(map);
    T.clearObstacles();
    T.clearPlatforms();
    P.clearPads();
  }
  AP.refreshRunways();
  APR.refreshApronElevation();
  const scene = new THREE.Scene();
  const a = new AP.Airport(scene);
  new APR.Apron(scene, 'high');
  const sc = new S.Scenery(scene, 'high');
  scene.updateMatrixWorld(true);
  const lay = AP.airportLayout();
  const elev = T.AIRPORT.elev ?? 0;

  /* ---- the town ---- */
  const town = sc.town || {};
  const f = town.facts;
  if (f && f.sizes.length) {
    // Every town vertex, bucketed, for the top of what is drawn over each house.
    const grid = new Map();
    const v = new THREE.Vector3();
    sc.group.traverse((o) => {
      if (!o.isMesh || !/^town-(house-walls|roofs)/.test(o.name)) return;
      const pos = o.geometry.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
        const k = `${Math.floor(v.x / 20)},${Math.floor(v.z / 20)}`;
        if (!grid.has(k)) grid.set(k, []);
        grid.get(k).push(v.x, v.y, v.z);
      }
    });
    const ridges = [];
    f.sizes.forEach((z) => {
      // Where it stands: its spot, its turn, its footprint and its ground.
      const sp = { x: z.x, z: z.z, rot: z.rot, w: z.w, d: z.d, y: z.ground };
      if (z.kind === 'block') {
        all.block.push(z.ridge);
        if (!(map.scenery.town.towers > 0) && z.ridge > 17) faults.block.push(`${map.id}: a village block ${z.ridge.toFixed(1)} m to its roof`);
        return;
      }
      houses++;
      all.eaves.push(z.eaves);
      all.ridge.push(z.ridge);
      ridges.push(z.ridge);
      if (Math.max(z.w, z.d) > 15 || Math.min(z.w, z.d) < 6) faults.footprint.push(`${map.id}: ${z.w.toFixed(1)} x ${z.d.toFixed(1)} m`);
      if (z.eaves < 2.9 || z.eaves > 6.5) faults.eaves.push(`${map.id}: eaves ${z.eaves.toFixed(2)} m`);
      if (z.ridge < 4.5 || z.ridge > 11) faults.ridge.push(`${map.id}: ridge ${z.ridge.toFixed(2)} m`);
      if (Math.abs(z.top - z.ridge - 0.32) > 0.01) faults.top.push(`${map.id}: solid to ${z.top.toFixed(2)} m over a ${z.ridge.toFixed(2)} m ridge`);
      // What is drawn: up to the ridge, and no more than a chimney (1.53 m) above it.
      const c = Math.cos(sp.rot);
      const s = Math.sin(sp.rot);
      let top = -Infinity;
      for (let gi = Math.floor((sp.x - 12) / 20); gi <= Math.floor((sp.x + 12) / 20); gi++) {
        for (let gj = Math.floor((sp.z - 12) / 20); gj <= Math.floor((sp.z + 12) / 20); gj++) {
          const list = grid.get(`${gi},${gj}`);
          if (!list) continue;
          for (let k = 0; k < list.length; k += 3) {
            const dx = list[k] - sp.x;
            const dz = list[k + 2] - sp.z;
            if (Math.abs(c * dx - s * dz) <= sp.w / 2 + 0.6 && Math.abs(s * dx + c * dz) <= sp.d / 2 + 0.6) top = Math.max(top, list[k + 1]);
          }
        }
      }
      const drawn = top - sp.y;
      if (!(drawn >= z.ridge - 0.05 && drawn <= z.ridge + 1.6)) faults.mesh.push(`${map.id}: drawn to ${drawn.toFixed(2)} m, ridge ${z.ridge.toFixed(2)} m`);
    });
    if (ridges.length) {
      all.mapRidge.push(median(ridges));
      if (median(ridges) < 6.5 || median(ridges) > 9.5) faults.ridge.push(`${map.id}: median ridge ${median(ridges).toFixed(2)} m`);
    }
    if (f.hoodClear < 0) faults.hood.push(`${map.id}: a door's hood ${(-f.hoodClear).toFixed(2)} m into its eaves`);
  }

  /* ---- trees ---- */
  const mapTrees = [];
  const m4 = new THREE.Matrix4();
  sc.group.traverse((o) => {
    if (!o.isInstancedMesh || !/^trees:/.test(o.name) || o.name === 'trees:scrub') return;
    if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
    const gh = o.geometry.boundingBox.max.y - o.geometry.boundingBox.min.y;
    for (let k = 0; k < o.count; k++) {
      o.getMatrixAt(k, m4);
      const h = gh * new THREE.Vector3().setFromMatrixColumn(m4, 1).length();
      mapTrees.push(h);
      all.tree.push(h);
      if (h < 2 || h > 32) faults.tree.push(`${map.id}: a ${o.name.slice(6)} ${h.toFixed(1)} m tall`);
    }
  });
  // A dry or wind-blasted map grows short trees on purpose (Ironhead's
  // thorn, the Stacks' 4-5 m): 3.5 m at the median is the floor.
  if (mapTrees.length && (median(mapTrees) < 3.5 || median(mapTrees) > 22)) faults.tree.push(`${map.id}: median tree ${median(mapTrees).toFixed(1)} m`);

  /* ---- cars ---- */
  const cars = a.group.getObjectByName('car-park');
  if (cars) {
    if (!cars.geometry.boundingBox) cars.geometry.computeBoundingBox();
    const g = cars.geometry.boundingBox;
    for (let k = 0; k < cars.count; k++) {
      cars.getMatrixAt(k, m4);
      const sx = new THREE.Vector3().setFromMatrixColumn(m4, 0).length();
      const sy = new THREE.Vector3().setFromMatrixColumn(m4, 1).length();
      const sz = new THREE.Vector3().setFromMatrixColumn(m4, 2).length();
      const L = Math.max((g.max.x - g.min.x) * sx, (g.max.z - g.min.z) * sz);
      const H = (g.max.y - g.min.y) * sy;
      all.car.push(L);
      all.carH.push(H);
      if (L < 3.8 || L > 5.2 || H < 1.2 || H > 1.9) faults.car.push(`${map.id}: a car ${L.toFixed(2)} m long, ${H.toFixed(2)} m tall`);
    }
  }

  /* ---- hangars ---- */
  for (const h of lay.hangars || []) {
    all.hangarH.push(h.H);
    if (h.H < 8 || h.H > 35) faults.hangar.push(`${map.id}: a hangar ${h.H} m to its eaves`);
  }
  const doors = a.group.getObjectByName('hangar-doors');
  if (doors) {
    if (!doors.geometry.boundingBox) doors.geometry.computeBoundingBox();
    const gh = doors.geometry.boundingBox.max.y - doors.geometry.boundingBox.min.y;
    for (let k = 0; k < doors.count; k++) {
      doors.getMatrixAt(k, m4);
      const h = gh * new THREE.Vector3().setFromMatrixColumn(m4, 1).length();
      all.door.push(h);
      if (h < 5 || h > 30) faults.hangar.push(`${map.id}: a hangar door ${h.toFixed(1)} m tall`);
    }
  }
  for (const o of T.OBSTACLES) {
    if (o.what === 'You flew into a hangar' && o.y1 - elev > 45) faults.hangar.push(`${map.id}: a hangar solid to ${(o.y1 - elev).toFixed(1)} m`);
  }

  /* ---- the control tower ---- */
  const tops = T.OBSTACLES.filter((o) => o.what === 'You flew into the control tower').map((o) => o.y1 - elev);
  if (tops.length) {
    const t = Math.max(...tops);
    all.tower.push(t);
    if (t < 15 || t > 80) faults.tower.push(`${map.id}: ${lay.shape} tower ${t.toFixed(1)} m to the top`);
  }

  /* ---- the terminal, the floodlight masts, the estate, downtown, the roof pads, the runway ---- */
  // The top of every collision box with this label, over the ground under its middle.
  const topOf = (label) => T.OBSTACLES.filter((o) => o.what === label).map((o) => o.y1 - T.heightAt((o.x0 + o.x1) / 2, (o.z0 + o.z1) / 2));
  if (lay.terminal && Number.isFinite(lay.terminal.H)) {
    all.terminal.push(lay.terminal.H);
    if (lay.terminal.H < 6 || lay.terminal.H > 28) faults.terminal.push(`${map.id}: the ${lay.terminal.name} ${lay.terminal.H} m to the eaves`);
  }
  for (const t of topOf('You flew into the terminal')) {
    all.terminalTop.push(t);
    if (t > 34) faults.terminal.push(`${map.id}: the terminal solid to ${t.toFixed(1)} m`);
  }
  for (const fl of lay.floods || []) {
    all.flood.push(fl.H);
    if (fl.H < 10 || fl.H > 35) faults.flood.push(`${map.id}: a floodlight mast ${fl.H} m`);
  }
  for (const t of topOf('You flew into a warehouse')) {
    all.shed.push(t);
    if (t < 8 || t > 22) faults.estate.push(`${map.id}: a warehouse ${t.toFixed(1)} m to its roof`);
  }
  for (const t of topOf('You flew into a hotel')) {
    all.hotel.push(t);
    if (t < 18 || t > 55) faults.estate.push(`${map.id}: a hotel ${t.toFixed(1)} m`);
  }
  const city = !!(map.scenery && map.scenery.town && map.scenery.town.towers > 0);
  for (const t of topOf('You flew into a tower')) {
    all.skyline.push(t);
    if (t < 50 || t > 260) faults.skyline.push(`${map.id}: a downtown tower ${t.toFixed(1)} m`);
  }
  if (f && f.sizes.length) {
    for (const z of f.sizes) {
      all.townGround.push(z.ground);
      if (city && z.kind === 'block') {
        all.cityBlock.push(z.ridge);
        if (z.ridge < 12 || z.ridge > 60) faults.skyline.push(`${map.id}: a downtown block ${z.ridge.toFixed(1)} m to its roof`);
      }
    }
  }
  for (const p of (map.scenery && map.scenery.pads) || []) {
    if (p.kind !== 'roof') continue;
    const above = p.above ?? 30;
    all.roofPad.push(above);
    if (above < 10 || above > 160) faults.roofPad.push(`${map.id}: ${p.name} ${above} m up`);
    if (p.id === 'hospital' && above > 40) faults.roofPad.push(`${map.id}: ${p.name} ${above} m up, taller than an office block`);
    // The building under it and the platform on it come from the same `above`
    // (pads.js: y = ground + above; the box from ground - 1 up y - 1.6 - ground,
    // so its top is y - 2.6; the platform at y). One source, so a pad moves
    // with its building. (heightAt ON the pad is the platform itself, so the
    // ground is not re-read here.)
    const tops2 = T.OBSTACLES.filter((o) => o.what === `You flew into ${p.name}`).map((o) => o.y1);
    const pl = T.PLATFORMS.find((q) => q.name === p.name);
    if (!tops2.length) faults.roofPad.push(`${map.id}: ${p.name} has no building under it`);
    if (!pl) faults.roofPad.push(`${map.id}: ${p.name} has no platform to land on`);
    if (tops2.length && pl) {
      const gap = pl.y - Math.max(...tops2);
      if (Math.abs(gap - 2.6) > 0.05) faults.roofPad.push(`${map.id}: ${p.name} platform ${gap.toFixed(2)} m over its building's solid top (2.6 expected)`);
    }
  }
  if (lay.runway) {
    const w = lay.runway.halfWidth * 2;
    all.rwyW.push(w);
    if (w < 18 || w > 70) faults.runway.push(`${map.id}: runway ${w} m wide`);
  }
  if (!carrier) carrier = C.DECK;
}

const list = (k, fallback) => faults[k].slice(0, 5).join('; ') + (faults[k].length > 5 ? ` (+${faults[k].length - 5} more)` : '') || fallback;
ok('every house: eaves 2.9-6.5 m over its ground', faults.eaves.length === 0, list('eaves', `${houses} houses, ${span(all.eaves)}`));
ok('every house: ridge 4.5-11 m, a map\'s median 6.5-9.5 m', faults.ridge.length === 0, list('ridge', `ridge ${span(all.ridge)}; map medians ${span(all.mapRidge)}`));
ok('every house: footprint 6-15 m each way', faults.footprint.length === 0, list('footprint', 'all'));
ok('every house is solid to its drawn ridge and half a metre more (one source)', faults.top.length === 0, list('top', 'all'));
ok('what is drawn over each house stops at its ridge (or its chimney)', faults.mesh.length === 0, list('mesh', `${houses} houses`));
ok('every front door\'s hood is under its eaves', faults.hood.length === 0, list('hood', 'all'));
ok('a village\'s blocks are no taller than 17 m to the roof', faults.block.length === 0, list('block', `blocks ${span(all.block)}`));
ok('trees: 2-32 m, a map\'s median 3.5-22 m (scrub apart; a dry or windswept map\'s are short)', faults.tree.length === 0, list('tree', `${all.tree.length} trees, ${span(all.tree)}`));
ok('the car park\'s cars: 3.8-5.2 m long, 1.2-1.9 m tall', faults.car.length === 0, list('car', `${all.car.length} cars, ${span(all.car)} long, ${span(all.carH)} tall`));
ok('hangars: 8-35 m to the eaves, doors 5-30 m, solid no higher than 45 m', faults.hangar.length === 0, list('hangar', `eaves ${span(all.hangarH)}, doors ${span(all.door)}`));
ok('control towers: 15-80 m to the top of the cab', faults.tower.length === 0, list('tower', span(all.tower)));
ok('terminals: 6-28 m to the eaves (a clubhouse 8, a hub 26), solid no higher than 34 m', faults.terminal.length === 0, list('terminal', `eaves ${span(all.terminal)}; solid to ${span(all.terminalTop)}`));
ok('floodlight masts: 10-35 m', faults.flood.length === 0, list('flood', span(all.flood)));
ok('the estate: warehouses 8-22 m to the roof, hotels 18-55 m', faults.estate.length === 0, list('estate', `warehouses ${span(all.shed)}; hotels ${span(all.hotel)}`));
ok('downtown (maps with towers): blocks 12-60 m to the roof, towers 50-260 m', faults.skyline.length === 0, list('skyline', `blocks ${span(all.cityBlock)}; towers ${span(all.skyline)}`));
ok('roof pads: 10-160 m up, a hospital no taller than an office block; each pad\'s platform 1.6 m over its own building\'s solid top (one source)', faults.roofPad.length === 0, list('roofPad', `${all.roofPad.length} pads, ${span(all.roofPad)} up`));
ok('runways: 18-70 m wide', faults.runway.length === 0, list('runway', span(all.rwyW)));
console.log(`INFO  the towns stand ${span(all.townGround)} above the sea: why the altimeter alone read a 180 ft house`);

/* ---- the road ---- */
{
  const w = R.PAVED_HALF * 2;
  ok('a road: two lanes and shoulders, 7-11 m of tarmac', w >= 7 && w <= 11, `${w} m (PAVED_HALF ${R.PAVED_HALF})`);
}

/* ---- vehicles: the airport's, and the one you drive ---- */
{
  const AV = await import(SRC + 'world/airport-vehicles.js');
  const VM = await import(SRC + 'vehicles/models.js');
  const gd = (g) => {
    g.computeBoundingBox();
    const b = g.boundingBox;
    const a = b.max.x - b.min.x;
    const c = b.max.z - b.min.z;
    return { L: Math.max(a, c), W: Math.min(a, c), H: b.max.y - b.min.y };
  };
  const od = (o) => {
    o.updateMatrixWorld(true);
    const b = new THREE.Box3().setFromObject(o);
    const a = b.max.x - b.min.x;
    const c = b.max.z - b.min.z;
    return { L: Math.max(a, c), W: Math.min(a, c), H: b.max.y - b.min.y };
  };
  // [builder, length lo-hi, height lo-hi] in metres, real sizes rounded
  // (airport-vehicles.js). The tug's geometry carries its tow bar (to z 7.4),
  // so it measures 10.3 m: a 5.4 m tug and a 4 m bar, as at a real stand.
  // The van is 4.7 m from its Blender model in the browser and a 3.5 m
  // procedural microvan when that cannot load (as here, in node).
  const want = {
    'tug (with its tow bar)': [() => gd(AV.tugGeometry()), 8, 11, 1.4, 3.2],
    'stair truck': [() => gd(AV.stairTruckGeometry()), 5.5, 9, 1.8, 4.5],
    'catering truck': [() => gd(AV.cateringTruckGeometry()), 6.5, 10, 2.2, 6],
    'fuel truck': [() => gd(AV.fuelTruckGeometry()), 7.5, 13, 2.4, 4.5],
    'fire engine': [() => gd(AV.fireEngineGeometry()), 7.5, 13, 2.4, 4.5],
    'belt loader': [() => gd(AV.beltLoaderGeometry()), 4, 9, 1.2, 3.5],
    'baggage tractor': [() => gd(AV.baggageTractorGeometry()), 2.2, 4.5, 1.2, 2.6],
    'baggage cart': [() => gd(AV.baggageCartGeometry()), 1.8, 3.5, 1, 2.5],
    'ground power unit': [() => gd(AV.gpuGeometry()), 1.8, 5, 1, 2.6],
    'car (airside)': [() => gd(AV.carGeometry()), 3.8, 5.2, 1.2, 1.9],
    'the van you drive': [() => od(VM.createCar()), 3.4, 5.6, 1.5, 2.6],
  };
  const bad = [];
  const got = [];
  for (const [name, [build, l0, l1, h0, h1]] of Object.entries(want)) {
    try {
      const d = build();
      got.push(`${name} ${d.L.toFixed(1)}x${d.W.toFixed(1)}x${d.H.toFixed(1)}`);
      if (d.L < l0 || d.L > l1 || d.H < h0 || d.H > h1) bad.push(`${name}: ${d.L.toFixed(1)} m long, ${d.H.toFixed(1)} m tall (want ${l0}-${l1} x ${h0}-${h1})`);
    } catch (e) {
      bad.push(`${name}: ${String(e.message).slice(0, 60)}`);
    }
  }
  ok('vehicles: the tug, the trucks, the carts, the cars and the van each the size of the real thing (L x W x H)', bad.length === 0, bad.join('; ') || got.join(', '));
}

/* ---- aircraft: the drawn plan against the real counterpart ---- */
{
  const TY = await import(SRC + 'aircraft/types.js');
  // [counterpart, length, span] in metres.
  const REAL = {
    skylark: ['Cessna 172', 8.28, 11.0],
    courier: ['Mooney M20', 7.5, 11.0],
    meridian: ['Dornier 328JET / ERJ-145', 26, 20.5],
    vanguard: ['F-16C', 15.06, 9.96],
    osprey: ['A-7 Corsair II', 14.06, 11.8],
    tempest: ['Dash 8-100', 22.25, 25.91],
    nightjar: ['B-2 Spirit', 21.0, 52.4],
    harrier: ['Bell 206 JetRanger', 11.9, 10.16],
    f22: ['F-22 Raptor', 18.92, 13.56],
    f35b: ['F-35B', 15.6, 10.7],
    fa18: ['F/A-18C Hornet', 17.1, 12.3],
    a320: ['Airbus A320', 37.57, 35.8],
    b747: ['Boeing 747-400', 70.6, 64.4],
    a380: ['Airbus A380', 72.7, 79.75],
    // new-aircraft (aircraft/extra/jets.js, giants.js)
    b737: ['Boeing 737 MAX 8', 39.52, 35.92],
    a321: ['Airbus A321neo', 44.51, 35.8],
    b787: ['Boeing 787-9', 62.81, 60.12],
    a350: ['Airbus A350-900', 66.8, 64.75],
    b777: ['Boeing 777-300ER', 73.86, 64.8],
    q400: ['Dash 8 Q400', 32.83, 28.42],
    concorde: ['Concorde', 61.66, 25.6],
    belugaxl: ['Airbus BelugaXL', 63.1, 60.3],
    dreamlifter: ['Boeing 747-400LCF', 71.68, 64.44],
    an225: ['Antonov An-225', 84.0, 88.4],
    c5: ['Lockheed C-5M', 75.31, 67.89],
    c17: ['Boeing C-17A', 53.04, 51.75],
    a10: ['Fairchild A-10C', 16.26, 17.53],
    // ...and the swing-wing bomber (aircraft/extra/lancer.js): its span with the wings forward, as parked.
    b1b: ['Rockwell B-1B Lancer', 44.5, 41.67],
    // ...and the helicopter wave (aircraft/extra/helis.js): length rotors turning, rotor diameter.
    bell407: ['Bell 407', 12.7, 10.67],
    h145: ['Airbus H145', 13.64, 11.0],
    r44: ['Robinson R44', 11.66, 10.06],
    aw139: ['Leonardo AW139', 16.66, 13.8],
    uh60: ['Sikorsky UH-60M', 19.76, 16.36],
    ch47: ['Boeing CH-47F', 30.1, 18.3],
    ah64: ['Boeing AH-64D', 17.73, 14.63],
    vh3d: ['Sikorsky VH-3D Sea King', 22.15, 18.9],
  };
  // Air Massimo is a made-up racer (21.5 m long, a 9.7 m wing: nothing real
  // to hold it to); T-Pose Harrison is a person flying with his arms out, a
  // joke, half size — neither is an aeroplane to measure.
  const SKIP = new Set(['massimo', 'tpose']);
  const bad = [];
  const lines = [];
  let trainer = null;
  for (const a of TY.AIRCRAFT) {
    if (!a.plan) {
      bad.push(`${a.name}: no plan`);
      continue;
    }
    const L = a.plan.tail - a.plan.nose;
    const S = a.plan.span;
    if (SKIP.has(a.id)) {
      lines.push(`${a.name} ${L.toFixed(1)}x${S.toFixed(1)} (made up; not held to a counterpart)`);
      continue;
    }
    // Up to the An-225, the largest aeroplane ever built (84 m by 88 m).
    if (L < 6 || L > 86 || S < 7 || S > 90) bad.push(`${a.name}: ${L.toFixed(1)} m long, ${S.toFixed(1)} m span`);
    const r = REAL[a.id];
    if (!r) {
      bad.push(`${a.name}: no real counterpart listed here`);
      continue;
    }
    const rl = L / r[1];
    const rs = S / r[2];
    lines.push(`${a.name} ${L.toFixed(1)}x${S.toFixed(1)} vs ${r[0]} ${r[1]}x${r[2]} (${rl.toFixed(2)}, ${rs.toFixed(2)})`);
    if (rl < 0.6 || rl > 1.5 || rs < 0.6 || rs > 1.5) bad.push(`${a.name}: ${rl.toFixed(2)} x the ${r[0]}'s length, ${rs.toFixed(2)} x its span`);
    if (a.id === 'skylark') trainer = { rl, rs };
  }
  ok(`aircraft: every drawn plan 6-86 m long and 7-90 m across, and within 0.6-1.5 of its real counterpart (${TY.AIRCRAFT.length} types; the made-up Massimo and the T-Pose joke printed, not held)`, bad.length === 0, bad.join('; ') || `${lines.length - SKIP.size} compared`);
  ok('the trainer is a Cessna 172 to within 15% (length and span)', !!trainer && Math.abs(trainer.rl - 1) <= 0.15 && Math.abs(trainer.rs - 1) <= 0.15, trainer ? `length x${trainer.rl.toFixed(2)}, span x${trainer.rs.toFixed(2)}` : 'no skylark');
  for (const l of lines) console.log(`INFO  ${l}`);
}

/* ---- people ---- */
{
  const box = new THREE.Box3();
  const hs = [];
  for (const outfit of ['pilot', 'passenger', 'crew', 'marshaller']) {
    const m = PER.createPerson({ outfit, seed: 5 });
    m.updateMatrixWorld(true);
    box.setFromObject(m);
    hs.push(box.max.y - box.min.y);
  }
  ok('people: 1.6-1.95 m tall', hs.every((h) => h >= 1.6 && h <= 1.95), hs.map((h) => h.toFixed(2)).join(', ') + ' m');
}

/* ---- the altitude line ---- */
{
  // Level with a 32 ft ridge, 5 ft over it: the panel's height over the ground.
  const cases = [[37, 35], [32, 30], [3, 5], [0, 0], [-4, 0], [99, 100], [104, 100], [1234, 1230]];
  const bad = cases.filter(([i, o]) => HUD.aboveGroundFt(i) !== o);
  ok('the altitude line gives the height over the ground, to 5 ft under 100 and 10 ft above', bad.length === 0,
    bad.length ? bad.map(([i, o]) => `${i} -> ${HUD.aboveGroundFt(i)}, not ${o}`).join('; ') : cases.map(([i, o]) => `${i}->${o}`).join(', '));

  /*
   * The same height in a few characters for the touch band and a narrow
   * window, which hide the sentence (the checker, v62: on an iPad the owner's
   * "200 ft house" was unchanged). Both come from altitudeWords(), so the
   * number in the short form is the number in the sentence, every time.
   */
  const W = HUD.altitudeWords;
  const num = (s) => { const m = /([\d,]+) ft/.exec(s); return m ? Number(m[1].replace(/,/g, '')) : NaN; };
  const flying = [3, 21, 32, 59, 60, 150, 399, 400, 1200, 1499];
  const agree = flying.every((agl) => {
    const o = W({ onGround: false, aglFt: agl });
    return /^[\d,]+ ft up$/.test(o.short) && num(o.short) === num(o.word) && num(o.short) === HUD.aboveGroundFt(agl);
  });
  ok('the short height line ("N ft up") carries the sentence\'s own number, up to 1,500 ft over the ground', agree,
    flying.map((agl) => `${agl}: "${W({ onGround: false, aglFt: agl }).short}"`).join(', '));
  const bands = [
    [W({ onGround: true, fieldFt: 140, aglFt: 0 }), 'on the ground', /^on the ground · field 140 ft$/],
    [W({ onGround: true, fieldFt: 4, aglFt: 0 }), 'on the ground', /^on the ground$/],
    [W({ onGround: false, aglFt: 21 }), '20 ft up', /^just off the ground · 20 ft up$/],
    [W({ onGround: false, aglFt: 150 }), '150 ft up', /^low · 150 ft over ground$/],
    [W({ onGround: false, aglFt: 1234 }), '1,230 ft up', /^safe · 1,230 ft over ground$/],
    [W({ onGround: false, aglFt: 3000 }), 'high up', /^high above the island$/],
    [W({ onGround: false, aglFt: 7000 }), 'very high', /^very high$/],
    [W({ onGround: false, aglFt: NaN }), '0 ft up', /^just off the ground · 0 ft up$/],
  ];
  const wrong = bands.filter(([o, short, word]) => o.short !== short || !word.test(o.word));
  ok('the altitude words, both lengths, band by band: on the ground, just off it, low, safe, high, very high',
    wrong.length === 0, wrong.length ? wrong.map(([o, s]) => `"${o.short}" / "${o.word}" (wanted "${s}")`).join('; ') : bands.map(([o]) => `"${o.short}"`).join(', '));

  /*
   * And the stylesheet puts it on screen exactly where the sentence is
   * hidden: off on a laptop (the sentence has the number), on in the touch
   * band (.hud.is-touch) and in the narrow-window block
   * (max-width 760 / pointer coarse), where .hud-word is display: none.
   */
  const css = readFileSync(new URL('../../styles/main.css', import.meta.url), 'utf8');
  const decl = (selector, prop) => {
    const re = new RegExp(selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{([^}]*)\\}', 'g');
    const out = [];
    for (let mm; (mm = re.exec(css));) { const d = new RegExp(prop + '\\s*:\\s*([^;}]+)').exec(mm[1]); if (d) out.push(d[1].trim()); }
    return out;
  };
  const narrowAt = css.indexOf('@media (max-width: 760px), (pointer: coarse) {');
  const narrow = narrowAt >= 0 ? css.slice(narrowAt, css.indexOf('\n}\n', narrowAt)) : '';
  const faultsCss = [];
  if (!decl('.hud-up', 'display').includes('none')) faultsCss.push('the laptop panel does not hide .hud-up (its sentence has the number)');
  if (!decl('.hud.is-touch .hud-left .hud-up', 'display').includes('block')) faultsCss.push('the touch band does not show .hud-up');
  if (!decl('.hud.is-touch .hud-left .hud-word', 'display').includes('none')) faultsCss.push('the touch band does not hide the sentence (a fine-pointer touchscreen would show both)');
  if (!/\.hud-left \.hud-word\s*\{\s*display:\s*none/.test(narrow)) faultsCss.push('the narrow-window block no longer hides .hud-word (then the sentence is back and this check is moot)');
  if (!/\.hud-left \.hud-up\s*\{[^}]*display:\s*block/.test(narrow)) faultsCss.push('the narrow-window block does not show .hud-up');
  ok('styles/main.css shows the short height line exactly where it hides the sentence: the touch band and a window of 760 px or narrower',
    faultsCss.length === 0, faultsCss.join('; ') || 'laptop off; touch band on, sentence off; narrow block on');

  /*
   * And not in a vehicle. The car and the tug keep the strip (TRIP, in
   * kilometres, in the altimeter's cell: ui/hud-drive.js), and the v62
   * checker found a flight's "1,200 ft up" — or the HUD's first text, "on
   * the ground" — under TRIP on an iPad and in a 696 px window: both blocks
   * showed .hud-up and nothing hid or emptied it there. DriveHud.enter()
   * empties it (the browser check drives the car and the tug); the two
   * blocks hide it in any vehicle as well, so a line written later cannot
   * come back.
   */
  const faultsVeh = [];
  if (!decl('.hud.is-touch.is-vehicle .hud-left .hud-up', 'display').includes('none')) faultsVeh.push('the touch band does not hide .hud-up in a vehicle (.hud.is-touch.is-vehicle .hud-left .hud-up)');
  if (!/\.hud\.is-vehicle \.hud-left \.hud-up\s*\{[^}]*display:\s*none/.test(narrow)) faultsVeh.push('the narrow-window block does not hide .hud-up in a vehicle (.hud.is-vehicle .hud-left .hud-up)');
  if (!decl('.hud-up:empty', 'display').some((d) => /none/.test(d))) faultsVeh.push('an empty .hud-up is not hidden (.hud-up:empty), so the emptied line would still take a row');
  ok('styles/main.css hides the short height line in a vehicle (the car, the tug) on the touch band and in a narrow window, and an empty one takes no room',
    faultsVeh.length === 0, faultsVeh.join('; ') || 'touch band off in a vehicle; narrow block off in a vehicle; empty hidden');
}

console.log(`INFO  the carrier: ${carrier.length} x ${carrier.width} m, deck ${carrier.y} m over the sea (x${C.SCALE} a real one, on purpose: src/world/carrier.js)`);
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);

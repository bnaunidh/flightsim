/**
 * World Map preview: the airports you did not start from, and their towns.
 *
 * The field you start from is the game's own airport (world/airport.js and
 * apron.js: terminal, stands, parked aircraft, tower, lights, ATC). The other
 * four are built here, lighter but real: the runway in the same runway
 * material as the main field, its shoulders, a parallel taxiway and
 * connectors where the field is big enough for them, an apron, a terminal
 * (or a flying-club hut), a control tower, hangars, fuel tanks, a windsock,
 * steady runway edge and threshold lights after dark, and a car park only at
 * a commercial field (owner, Oct 25). Every building is solid
 * (terrain.js addObstacleAt), and the taxiway and apron roll as tarmac.
 *
 * Each field is one group in its own frame, at its runway centre, so no
 * vertex is more than a few kilometres from its own origin. Two draw calls a
 * field by day (the runway, everything else), one more at night (the lights),
 * and a field further away than its tier's range is hidden outright.
 *
 * The towns of the other islands are the game's own town builder
 * (scenery.js planTown / addTown): streets, houses and blocks, lit windows at
 * night. The hub's town is built by Scenery itself, as every map's is.
 */
import * as THREE from '../../vendor/three.module.js';
import { addObstacleAt, addPlatform, heightAt } from '../terrain.js';
import { runwayTexture, asphaltNormal, iceRunwayTexture } from '../../render/textures.js';
import { Batch, vcMaterial, layer, glowPoints } from '../airport-kit.js';
import { planTown, addTown, treeGeometry } from '../scenery.js';
import { papiFor } from '../navfield.js';
import { styleOf } from './personas.js';
import * as LOOK from './field-look.js';

/** The share of a town's buildings built at each tier (the World Map's towns are all built at load). */
export const TOWN_SHARE = Object.freeze({ low: 0.45, medium: 0.7, high: 1, ultra: 1.15 });

/** How far away each piece is still drawn, by graphics quality. */
export const SHOW_RANGE = Object.freeze({ low: 14000, medium: 20000, high: 26000, ultra: 32000 });

const C = {
  asphalt: 0x4f5254,
  concrete: 0x9c9c97,
  shoulder: 0x6c6e6a,
  wall: 0xd9d4c8,
  glass: 0x5f7f96,
  roof: 0x7d8288,
  hangar: 0xb7bcc0,
  tower: 0xe7e4dc,
  tank: 0xe8e8e2,
  car: [0xb8bec4, 0x2f3a46, 0x8a1f24, 0xe6e6e0, 0x3a5a3a, 0x20262c],
  sock: 0xf06a1a,
};

const stripMats = {};
function stripMaterial(surface) {
  if (stripMats[surface]) return stripMats[surface];
  // A polar field's strip is compacted snow and ice, marked (airport.js polarField).
  const m = surface === 'ice'
    ? new THREE.MeshStandardMaterial({ map: iceRunwayTexture(), roughness: 0.55, metalness: 0 })
    : new THREE.MeshStandardMaterial({ color: surface === 'gravel' ? 0x8c8576 : 0x6f8a4a, roughness: 1, metalness: 0 });
  m.userData.shared = true;
  stripMats[surface] = m;
  return m;
}

let runwayMat = null;
function sharedRunwayMaterial() {
  if (runwayMat) return runwayMat;
  runwayMat = new THREE.MeshStandardMaterial({
    map: runwayTexture(),
    normalMap: asphaltNormal(),
    normalScale: new THREE.Vector2(0.45, 0.45),
    roughness: 0.9,
    metalness: 0.02,
  });
  layer(runwayMat, 'runway');
  runwayMat.userData.shared = true;
  return runwayMat;
}

/**
 * One field's plan, in its own frame (x along the runway, -z to the north):
 * the same layout airport-layout.js makes when the field is the one you
 * start from, measured by tools/worldmap/preview-layout.mjs and kept in the
 * data (`a.layout`), so a field is laid out the same whether or not you
 * started there. Pure numbers; the node test reads this too.
 */
export function fieldPlan(a) {
  const lay = a.layout || {};
  const paved = (lay.pavement || []).map((p) => ({ ...p }));
  if (lay.carPark) paved.push({ kind: 'carpark', ...lay.carPark });
  const buildings = [];
  if (lay.terminal) buildings.push({ kind: 'terminal', ...lay.terminal, h: Math.min(lay.terminal.h || 14, a.kind === 'hub' ? 22 : 14) });
  if (lay.tower) buildings.push({ kind: 'tower', ...lay.tower, h: lay.tower.h || 20 });
  for (const h of lay.hangars || []) buildings.push({ kind: 'hangar', ...h, h: h.h || 14 });
  if (lay.fire) buildings.push({ kind: 'fire station', ...lay.fire, h: 8 });
  const tanks = [];
  if (lay.fuel) {
    const f = lay.fuel;
    const n = Math.max(1, f.tanks || 2);
    const r = Math.min(f.r || 6, (f.z1 - f.z0) / 2 - 2);
    for (let i = 0; i < n; i++) {
      tanks.push({ x: f.x0 + ((i + 0.5) * (f.x1 - f.x0)) / n, z: (f.z0 + f.z1) / 2, r: Math.min(r, (f.x1 - f.x0) / n / 2 - 1.5), h: f.h || 10 });
    }
  }
  const sock = lay.windsock || { x: -a.length / 2 + 140, z: a.halfWidth + 70 };
  return { paved, buildings, tanks, carPark: lay.carPark ? { kind: 'carpark', ...lay.carPark } : null, sock };
}

/**
 * Where the Tower view stands at field `a`, in the world: on the runway side
 * of its tower's cab, just outside the glass (buildField draws the cab
 * 3.5 m wider than the shaft), at the cab's height. Null for a field with no
 * tower. camera.js CameraRig.towers; features/world-preview.js sets them.
 */
export function towerLens(a) {
  const t = a && a.layout && a.layout.tower;
  if (!t) return null;
  const h = t.h || 20;
  const cx = (t.x0 + t.x1) / 2;
  const cz = (t.z0 + t.z1) / 2;
  const out = (t.z1 - t.z0) / 2 + 4;
  return { x: a.x + cx, y: a.elev + h + 1.5, z: a.z + cz + (cz < 0 ? out : -out), code: a.code };
}

/** One field, in a group at its runway centre. */
export function buildField(a, quality = 'medium') {
  const g = new THREE.Group();
  g.name = `world-field ${a.code}`;
  g.position.set(a.x, a.elev, a.z);
  const plan = fieldPlan(a);
  const L = a.length;
  const hw = a.halfWidth;

  // The runway, made exactly the way the main field makes its own; a grass
  // or gravel strip is a mown or rolled strip with white edge markers instead.
  const rough = a.surface === 'grass' || a.surface === 'gravel';
  const rgeo = new THREE.PlaneGeometry(hw * 2, L);
  rgeo.rotateX(-Math.PI / 2);
  const runway = new THREE.Mesh(rgeo, rough ? stripMaterial(styleOf(a).snow ? 'ice' : a.surface) : sharedRunwayMaterial());
  runway.rotation.y = Math.PI / 2;
  runway.position.set(0, 0.06, 0);
  runway.receiveShadow = true;
  runway.name = 'runway';
  g.add(runway);

  const b = new Batch();
  if (rough) {
    // Edge markers every 90 m and a threshold bar of them at each end.
    for (let u = -L / 2; u <= L / 2 + 0.1; u += 90) for (const v of [-hw - 1, hw + 1]) b.box(2.2, 0.35, 0.6, u, 0.18, v, 0xf2f2ee);
    for (const end of [-1, 1]) for (let v = -hw + 2; v <= hw - 2; v += 4) b.box(0.6, 0.3, 2.2, end * (L / 2 - 4), 0.15, v, 0xf2f2ee);
  } else b.flat(L + 40, hw * 2 + 28, 0, 0.02, 0, C.shoulder);
  for (const r of plan.paved) {
    const col = r.kind === 'apron' || r.kind === 'lead-in' ? C.concrete : r.kind === 'carpark' ? 0x3f4245 : C.asphalt;
    b.flat(r.x1 - r.x0, r.z1 - r.z0, (r.x0 + r.x1) / 2, r.kind === 'apron' ? 0.045 : 0.05, (r.z0 + r.z1) / 2, col);
  }
  // Centreline paint on the taxiway, in yellow.
  const twy = plan.paved.find((r) => r.kind === 'taxiway');
  if (twy) b.flat(twy.x1 - twy.x0, 0.3, (twy.x0 + twy.x1) / 2, 0.07, (twy.z0 + twy.z1) / 2, 0xd9c02a);

  const night = [];
  // In the style of the map whose airport this is (worldmap/personas.js, field-look.js).
  const st = styleOf(a);
  for (const s of plan.buildings) {
    const w = s.x1 - s.x0;
    const d = s.z1 - s.z0;
    const cx = (s.x0 + s.x1) / 2;
    const cz = (s.z0 + s.z1) / 2;
    if (s.kind === 'terminal') LOOK.terminal(b, s, st, night);
    else if (s.kind === 'tower') LOOK.tower(b, s, st, night);
    else if (s.kind === 'fire station') {
      b.box(w, s.h, d, cx, s.h / 2, cz, st.wall);
      for (let x = s.x0 + 4; x < s.x1 - 3; x += 8) b.box(6, s.h * 0.7, 0.3, x, s.h * 0.35, s.z1 + 0.15, 0xb8322a);
      b.box(w + 0.6, 0.6, d + 0.6, cx, s.h + 0.3, cz, st.roofCol);
    } else LOOK.hangar(b, s, st);
    addObstacleAt(a.x + cx, a.z + cz, w + 1, d + 1, a.elev - 1, s.h + (s.kind === 'tower' ? 8 : 4), `You flew into the ${s.kind} at ${a.name}`);
  }
  // Its own landmarks: the air base's shelters, the radomes, the silos, the lighthouse on the headland...
  const dressed = LOOK.dress(b, a, night);
  // And an apron in use: airliners on the stands, bridges at the big fields, floodlights.
  LOOK.apronDressing(b, a, st, night);
  for (const t of plan.tanks) {
    b.cyl(t.r, t.r, t.h, t.x, 0, t.z, C.tank, 16);
    addObstacleAt(a.x + t.x, a.z + t.z, t.r * 2, t.r * 2, a.elev - 1, t.h + 1, `You flew into the fuel tanks at ${a.name}`);
  }
  if (plan.carPark) {
    // Cars in rows, a few gaps: a car park that is in use.
    const cp = plan.carPark;
    let n = 0;
    for (let z = cp.z0 + 6; z < cp.z1 - 4; z += 7.5) {
      for (let x = cp.x0 + 4; x < cp.x1 - 3; x += 3.1) {
        const q = Math.abs(Math.sin(x * 12.9898 + z * 78.233) * 43758.5453) % 1;
        if (q < 0.32) continue;
        b.box(1.8, 1.45, 4.3, x, 0.75, z, C.car[n++ % C.car.length]);
      }
    }
  }
  // The PAPI at each end: four boxes on the north side, 200 m in from the
  // threshold (airport.js's spacing), lenses lit by update() for whoever is
  // on the approach. Not at a grass or gravel strip.
  const papi = [];
  if (!rough) {
    for (const end of [-1, 1]) {
      const px = end * (L / 2 - 200);
      const pz = -hw - 15;
      for (let i = 0; i < 4; i++) {
        const z = pz - i * 6;
        b.box(2.4, 1.5, 1.6, px, 0.75, z, 0x2a2d33);
        papi.push({ end, x: px - end * 1.3, z });
      }
    }
  }

  // The windsock on its mast, south of the runway.
  b.cyl(0.12, 0.16, 7, plan.sock.x, 0, plan.sock.z, 0xd8d8d8, 6);
  b.cyl(0.55, 0.35, 3.6, plan.sock.x + 1.8, 6.6, plan.sock.z, C.sock, 8, { rz: Math.PI / 2 });
  const mesh = b.mesh(vcMaterial({ roughness: 0.82 }), { cast: quality !== 'low', receive: true, name: 'field' });
  // Vertex colours, no texture: the UVs are dead weight (a sixth of the field's memory).
  if (mesh) {
    mesh.geometry.deleteAttribute('uv');
    g.add(mesh);
  }

  // Night: steady lights. Edges every 60 m, white; thresholds green; ends red. No flashing.
  const pos = [];
  const col = [];
  const put = (x, y, z, c) => {
    pos.push(x, y, z);
    const cc = new THREE.Color(c);
    col.push(cc.r, cc.g, cc.b);
  };
  for (let u = -L / 2; u <= L / 2 + 0.1; u += 60) {
    put(u, 0.5, -hw - 1.5, 0xfff1d0);
    put(u, 0.5, hw + 1.5, 0xfff1d0);
  }
  for (let v = -hw; v <= hw + 0.1; v += 3) {
    put(-L / 2 - 1, 0.4, v, 0x37e05a);
    put(L / 2 + 1, 0.4, v, 0x37e05a);
  }
  if (twy) for (let u = twy.x0; u <= twy.x1; u += 45) put(u, 0.4, (twy.z0 + twy.z1) / 2 + 9, 0x3a7dff);
  for (const [x, y, z, , c] of night) put(x, y, z, c || 0xffe2a8);
  const lights = glowPoints(pos, col, 3.2, { name: 'field-lights' });
  lights.visible = false;
  g.add(lights);
  g.userData.lights = lights;
  if (papi.length) {
    const lens = new THREE.InstancedMesh(new THREE.CircleGeometry(0.62, 12), new THREE.MeshBasicMaterial({ color: 0xffffff }), papi.length);
    lens.name = 'papi';
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const one = new THREE.Vector3(1, 1, 1);
    papi.forEach((p, i) => {
      // Facing the approach: west for the 09 end (end -1), east for the 27 end.
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), p.end < 0 ? -Math.PI / 2 : Math.PI / 2);
      lens.setMatrixAt(i, m4.compose(new THREE.Vector3(p.x, 0.85, p.z), q, one));
      lens.setColorAt(i, new THREE.Color(0xff2d20));
    });
    lens.frustumCulled = false;
    g.add(lens);
    g.userData.papi = { lens, lights: papi, whites: [-1, -1] };
  }
  // The palms of a tropical field, one instanced mesh.
  const palms = palmGroves(dressed.palms, quality);
  if (palms) g.add(palms);
  // The carrier group lying off the air base, seen from the other fields (the
  // ship itself, with its deck, is built only round the field you start from).
  if (a.carrier && (a.landmarks || []).some((l) => l.kind === 'escort')) {
    const cg = farCarrierMesh();
    cg.position.set(a.carrier.x - a.x, -a.elev, a.carrier.z - a.z);
    cg.updateMatrix();
    g.add(cg);
    // A deck you can land on (no wires: those are the ship you start from), and an island you cannot fly through.
    addPlatform(a.carrier.x, a.carrier.z, 360, 1500, 104, `${a.name} carrier group`);
    addObstacleAt(a.carrier.x + 122, a.carrier.z + 115, 67, 145, 104, 160, `You flew into the carrier off ${a.name}`);
  }
  g.userData.plan = plan;
  g.userData.airport = a;
  return g;
}

let palmGeo = null;
let palmMat = null;
function palmGroves(list, quality) {
  if (!list || !list.length) return null;
  if (!palmGeo) {
    palmGeo = treeGeometry(0);
    palmMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, side: THREE.DoubleSide });
    palmMat.userData.shared = true;
  }
  const m = new THREE.InstancedMesh(palmGeo, palmMat, list.length);
  const d = new THREE.Object3D();
  list.forEach(([x, z, h], i) => {
    d.position.set(x, -0.3, z);
    d.rotation.set(0, (x * 0.37 + z * 0.11) % 6.28, 0);
    d.scale.setScalar(h);
    d.updateMatrix();
    m.setMatrixAt(i, d.matrix);
  });
  m.name = 'field-palms';
  m.castShadow = quality !== 'low';
  return m;
}

let farCarrierGeo = null;
let farCarrierMat = null;
/** The carrier as one grey mesh, the same size as carrier.js's (5x a real ship: 1,500 x 360 m, deck 104 m). */
function farCarrierMesh() {
  if (!farCarrierGeo) {
    farCarrierGeo = LOOK.carrierProxyGeometry({ length: 1500, width: 360, y: 104 });
    farCarrierMat = new THREE.MeshLambertMaterial({ color: 0x5d646c });
    farCarrierMat.userData.shared = true;
  }
  const m = new THREE.Mesh(farCarrierGeo, farCarrierMat);
  m.name = 'field-carrier-group';
  m.matrixAutoUpdate = false;
  return m;
}

/**
 * The field you start from: airport.js and apron.js build its runway,
 * buildings, stands and lights; this adds its persona's own landmarks (the
 * air base's shelters, Northwatch's radomes, Harrier Flats' silos, a
 * lighthouse on the headland, the carrier group's escorts...), the same ones
 * buildField draws when it is someone else's field. Null if it has none.
 */
export function buildDressing(a, quality = 'medium') {
  if (!(a.extras && a.extras.length) && !(a.landmarks && a.landmarks.length)) return null;
  const g = new THREE.Group();
  g.name = `world-dressing ${a.code}`;
  g.position.set(a.x, a.elev, a.z);
  const b = new Batch();
  const night = [];
  const dressed = LOOK.dress(b, a, night);
  const mesh = b.mesh(vcMaterial({ roughness: 0.82 }), { cast: quality !== 'low', receive: true, name: 'dressing' });
  if (mesh) {
    mesh.geometry.deleteAttribute('uv');
    g.add(mesh);
  }
  const palms = palmGroves(dressed.palms, quality);
  if (palms) g.add(palms);
  if (night.length) {
    const pos = [];
    const col = [];
    const c = new THREE.Color();
    for (const [x, y, z, , hex] of night) {
      pos.push(x, y, z);
      c.set(hex || 0xffe2a8);
      col.push(c.r, c.g, c.b);
    }
    const lights = glowPoints(pos, col, 3.2, { name: 'dressing-lights' });
    lights.visible = false;
    g.add(lights);
    g.userData.lights = lights;
  }
  g.userData.airport = a;
  return g;
}

/** Is this world point on any of these fields' made ground (taxiway, apron, lead-ins, car park)? */
export function pavedTest(fields) {
  const boxes = [];
  for (const a of fields) {
    for (const r of fieldPlan(a).paved) boxes.push({ x0: a.x + r.x0, x1: a.x + r.x1, z0: a.z + r.z0, z1: a.z + r.z1 });
  }
  let bx0 = Infinity;
  let bx1 = -Infinity;
  let bz0 = Infinity;
  let bz1 = -Infinity;
  for (const r of boxes) {
    bx0 = Math.min(bx0, r.x0); bx1 = Math.max(bx1, r.x1);
    bz0 = Math.min(bz0, r.z0); bz1 = Math.max(bz1, r.z1);
  }
  return (x, z) => {
    if (x < bx0 || x > bx1 || z < bz0 || z > bz1) return false;
    for (let i = 0; i < boxes.length; i++) {
      const r = boxes[i];
      if (x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1) return true;
    }
    return false;
  };
}

/**
 * Everything outside the main field: the other fields and the other towns.
 * Returns { group, fields, towns, update(dt, weather, camPos) }.
 */
export function buildOutstations(data, departureId, quality = 'medium') {
  const t0 = performance.now();
  const group = new THREE.Group();
  group.name = 'world-outstations';
  const fields = [];
  for (const a of data.airports) {
    if (a.id === departureId) continue;
    const f = buildField(a, quality);
    group.add(f);
    fields.push(f);
  }
  const timing = { fields: 0, towns: {} };
  timing.fields = Math.round(performance.now() - t0);
  const towns = [];
  const density = quality === 'low' ? 0.35 : quality === 'medium' ? 0.65 : quality === 'ultra' ? 1.8 : 1;
  const hub = data.airports[0];
  /*
   * Every town is built now, behind the loading screen, and hidden until it
   * is in reach: building one in flight is a few hundred milliseconds on a
   * Chromebook, a hitch that is worse than the memory it would save.
   */
  const buildTown = (rec) => {
    const t = rec.town;
    const tb = performance.now();
    // A city's downtown where the plan gives it towers (scenery.js layTown): a grid round the centre, taller to the middle.
    // Fewer buildings on the lighter tiers (laying a town out is quadratic in its size, and every town is built at load).
    const count = Math.max(Math.min(t.count, 12), Math.round(t.count * (TOWN_SHARE[quality] || 1)));
    const cfg = { cx: t.cx, cz: t.cz, radius: t.radius, count, minH: Math.max(1.5, t.elev - 25), maxH: t.elev + 45, ...(t.towers ? { towers: Math.max(2, Math.round(t.towers * (TOWN_SHARE[quality] || 1))), towerMaxH: t.towerMaxH } : {}) };
    try {
      const plan = planTown(cfg, density);
      rec.built = addTown(rec.group, plan.spots, { ...(plan.cfg || {}), quality, meshName: `town-${t.airport || t.name}` });
      for (const m of rec.built.nightMats || []) m.emissiveIntensity = Math.max(0, glow);
    } catch (err) {
      console.warn(`[world-preview] the town of ${t.name} could not be built`, err);
      rec.built = { houses: 0, blocks: 0, nightMats: [] };
    }
    rec.ms = performance.now() - tb;
  };
  for (const t of data.towns) {
    if (t.airport === hub.id) continue; // Scenery builds the hub's own town
    const tg = new THREE.Group();
    tg.name = `world-town ${t.name}`;
    group.add(tg);
    towns.push({ group: tg, town: t, built: null });
  }
  const range = SHOW_RANGE[quality] || SHOW_RANGE.medium;
  let glow = -1;
  for (const rec of towns) {
    buildTown(rec);
    timing.towns[rec.town.name] = rec.ms ? Math.round(rec.ms) : 0;
  }
  return {
    group,
    fields,
    towns,
    timing,
    update(dt, weather, cam) {
      const isNight = !!(weather && weather.isNight);
      const dusk = weather && (weather.time === 'sunset' || weather.time === 'dusk');
      for (const f of fields) {
        const a = f.userData.airport;
        const d = cam ? Math.hypot(cam.x - a.x, cam.z - a.z) : 0;
        f.visible = d < range;
        if (f.userData.lights) f.userData.lights.visible = f.visible && (isNight || dusk || (weather && weather.cond && weather.cond.cloud > 0.8));
        if (f.visible && f.userData.papi && cam) setPapi(f.userData.papi, a, cam);
      }
      const want = isNight ? 1.15 : dusk ? 0.45 : 0;
      for (const t of towns) {
        const d = cam ? Math.hypot(cam.x - t.town.cx, cam.z - t.town.cz) : 0;
        t.group.visible = d < range && !!t.built;
      }
      if (want !== glow) {
        glow = want;
        for (const t of towns) for (const m of (t.built && t.built.nightMats) || []) m.emissiveIntensity = want;
      }
    },
  };
}

/** Light a field's PAPI for an eye at `eye` (world metres): each end's own glide angle (world/navfield.js papiFor). */
const _white = new THREE.Color(0xffffff);
const _red = new THREE.Color(0xff2d20);
export function setPapi(P, a, eye) {
  let changed = false;
  for (const end of [-1, 1]) {
    const f = { cx: a.x, cz: a.z, elev: a.elev, length: a.length, halfWidth: a.halfWidth, dir: -end };
    const w = papiFor(f, eye).whites;
    const k = end < 0 ? 0 : 1;
    if (P.whites[k] === w) continue;
    P.whites[k] = w;
    changed = true;
    let n = 0;
    P.lights.forEach((l, i) => {
      if (l.end !== end) return;
      P.lens.setColorAt(i, n++ < w ? _white : _red);
    });
  }
  if (changed) P.lens.instanceColor.needsUpdate = true;
  return P.whites;
}

/** Ground height under a field point, for the tests: the field's own level. */
export function fieldGround(a, lx, lz) {
  return heightAt(a.x + lx, a.z + lz);
}

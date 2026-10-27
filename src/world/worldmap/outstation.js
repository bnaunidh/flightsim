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
import { addObstacleAt, heightAt } from '../terrain.js';
import { runwayTexture, asphaltNormal } from '../../render/textures.js';
import { Batch, vcMaterial, layer, glowPoints } from '../airport-kit.js';
import { planTown, addTown } from '../scenery.js';

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

  // The runway, made exactly the way the main field makes its own.
  const rgeo = new THREE.PlaneGeometry(hw * 2, L);
  rgeo.rotateX(-Math.PI / 2);
  const runway = new THREE.Mesh(rgeo, sharedRunwayMaterial());
  runway.rotation.y = Math.PI / 2;
  runway.position.set(0, 0.06, 0);
  runway.receiveShadow = true;
  runway.name = 'runway';
  g.add(runway);

  const b = new Batch();
  b.flat(L + 40, hw * 2 + 28, 0, 0.02, 0, C.shoulder);
  for (const r of plan.paved) {
    const col = r.kind === 'apron' || r.kind === 'lead-in' ? C.concrete : r.kind === 'carpark' ? 0x3f4245 : C.asphalt;
    b.flat(r.x1 - r.x0, r.z1 - r.z0, (r.x0 + r.x1) / 2, r.kind === 'apron' ? 0.045 : 0.05, (r.z0 + r.z1) / 2, col);
  }
  // Centreline paint on the taxiway, in yellow.
  const twy = plan.paved.find((r) => r.kind === 'taxiway');
  if (twy) b.flat(twy.x1 - twy.x0, 0.3, (twy.x0 + twy.x1) / 2, 0.07, (twy.z0 + twy.z1) / 2, 0xd9c02a);

  const night = [];
  for (const s of plan.buildings) {
    const w = s.x1 - s.x0;
    const d = s.z1 - s.z0;
    const cx = (s.x0 + s.x1) / 2;
    const cz = (s.z0 + s.z1) / 2;
    if (s.kind === 'terminal') {
      b.box(w, s.h, d, cx, s.h / 2, cz, C.wall);
      // A band of glass along the airside face, and the roof.
      b.box(w * 0.96, s.h * 0.42, 0.4, cx, s.h * 0.55, s.z1 + 0.2, C.glass);
      b.box(w + 2, 0.8, d + 2, cx, s.h + 0.4, cz, C.roof);
      night.push([cx, s.h * 0.55, s.z1 + 1.5, w * 0.9]);
    } else if (s.kind === 'tower') {
      b.box(w, s.h, d, cx, s.h / 2, cz, C.tower);
      b.box(w + 3.5, 4.2, d + 3.5, cx, s.h + 2.1, cz, C.glass);
      b.box(w + 4.5, 0.6, d + 4.5, cx, s.h + 4.5, cz, C.roof);
      night.push([cx, s.h + 2.1, cz, 2]);
    } else {
      b.box(w, s.h, d, cx, s.h / 2, cz, C.hangar);
      b.box(w * 0.86, s.h * 0.78, 0.3, cx, s.h * 0.39, s.z1 + 0.15, 0x8f959b);
    }
    addObstacleAt(a.x + cx, a.z + cz, w + 1, d + 1, a.elev - 1, s.h + (s.kind === 'tower' ? 6 : 1.5), `You flew into the ${s.kind} at ${a.name}`);
  }
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
  // The windsock on its mast, south of the runway.
  b.cyl(0.12, 0.16, 7, plan.sock.x, 0, plan.sock.z, 0xd8d8d8, 6);
  b.cyl(0.55, 0.35, 3.6, plan.sock.x + 1.8, 6.6, plan.sock.z, C.sock, 8, { rz: Math.PI / 2 });
  const mesh = b.mesh(vcMaterial({ roughness: 0.82 }), { cast: quality !== 'low', receive: true, name: 'field' });
  if (mesh) g.add(mesh);

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
  for (const [x, y, z] of night) put(x, y, z, 0xffe2a8);
  const lights = glowPoints(pos, col, 3.2, { name: 'field-lights' });
  lights.visible = false;
  g.add(lights);
  g.userData.lights = lights;
  g.userData.plan = plan;
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
  for (const t of data.towns) {
    if (t.airport === hub.id) continue; // Scenery builds the hub's own town
    const tg = new THREE.Group();
    tg.name = `world-town ${t.name}`;
    const cfg = { cx: t.cx, cz: t.cz, radius: t.radius, count: t.count, minH: Math.max(1.5, t.elev - 25), maxH: t.elev + 45 };
    let built = null;
    try {
      const plan = planTown(cfg, density);
      built = addTown(tg, plan.spots, { ...(plan.cfg || {}), quality, meshName: `town-${t.airport}` });
    } catch (err) {
      console.warn(`[world-preview] the town of ${t.name} could not be built`, err);
    }
    group.add(tg);
    towns.push({ group: tg, town: t, built });
    timing.towns[t.name] = Math.round(performance.now() - t0) - timing.fields - Object.values(timing.towns).reduce((x, y) => x + y, 0);
  }
  const range = SHOW_RANGE[quality] || SHOW_RANGE.medium;
  let glow = -1;
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
      }
      const want = isNight ? 1.15 : dusk ? 0.45 : 0;
      for (const t of towns) {
        const d = cam ? Math.hypot(cam.x - t.town.cx, cam.z - t.town.cz) : 0;
        t.group.visible = d < range;
      }
      if (want !== glow) {
        glow = want;
        for (const t of towns) for (const m of (t.built && t.built.nightMats) || []) m.emissiveIntensity = want;
      }
    },
  };
}

/** Ground height under a field point, for the tests: the field's own level. */
export function fieldGround(a, lx, lz) {
  return heightAt(a.x + lx, a.z + lz);
}

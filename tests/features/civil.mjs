/**
 * The five civil airframes: Skylark 172, Kestrel Courier, Meridian 220,
 * Tempest WR-4 and Skyhook H-3 (id 'harrier').
 *
 *   node tests/features/civil.mjs
 *
 * What it holds them to:
 *
 *  - they build, through model-adapter.js (the call main.js makes), from
 *    their own airframes in src/aircraft/models/ and not from the generic
 *    factory's fallback;
 *  - no NaN anywhere, and under the triangle budget (instances counted);
 *  - THE FLIGHT MODEL IS UNCHANGED FROM 0db28ca: every gear point (position,
 *    spring, damper, travel), every strike point, the eye, the scale and
 *    every number specFor() hands the physics, compared with values taken
 *    from that commit;
 *  - the drawn tyres (skids, on the helicopter) touch within 3 cm of the
 *    contact points the physics lands on, and nothing is drawn below the
 *    ground those points define — the old Meridian's engines were 1.36 m
 *    under the runway;
 *  - the drawn tail does not reach the runway at a lower pitch than the
 *    physics' tail-strike point, and nothing outboard of the main wheels
 *    (propellers aside) reaches it at a lower bank than the wing tip does;
 *  - every moving part moves the right way for its control;
 *  - a running rotor or propeller can be seen from the chase view (blades
 *    drawn, or a blur disc that darkens a white sky by a set number of
 *    levels), thins from the pilot's seat, and is not drawn turning so fast
 *    that it aliases backwards;
 *  - update() with the half-empty state the apron passes leaves no NaN;
 *  - no mesh is named so that groundOffsetFor() would try to re-seat it.
 *
 * Needs no browser: canvas is stubbed, as tools/aircraft-colour.mjs does.
 */
global.document = {
  createElement: () => ({
    getContext: () => new Proxy({}, { get: () => () => ({ addColorStop() {}, data: new Uint8ClampedArray(4) }) }),
    width: 0,
    height: 0,
    style: {},
  }),
  body: { appendChild() {} },
};

const SRC = new URL('../../src/', import.meta.url).href;
const THREE = await import(SRC + 'vendor/three.module.js');
const { getAircraft, specFor } = await import(SRC + 'aircraft/types.js');
const adapter = await import(SRC + 'aircraft/model-adapter.js');
const legacy = await import(SRC + 'aircraft/model.js');
const { schemeFor, findLivery } = await import(SRC + 'aircraft/liveries.js');

const IDS = ['skylark', 'courier', 'meridian', 'tempest', 'harrier'];
// The brief says "under about 6,000". This was 6500, set to let the Tempest
// through at 6244; its cabin had a ring every 0.42 through a constant
// section, and without them it is 5924.
const TRI_BUDGET = 6000;

/* Taken with specFor() at 3327c54 and checked again at 0db28ca, where
 * src/aircraft is byte-identical: [name, x, y, z, k, c, travel] per gear
 * point, [part, x, y, z] per strike point, rounded to 1e-4. */
const BASE = {"skylark":{"scale":1,"eye":[-0.24,0.46,0.06],"gear":[["nose",0,-1.42,-1.15,26000,4200,0.2],["left",-1.42,-1.5,0.42,34000,5200,0.26],["right",1.42,-1.5,0.42,34000,5200,0.26]],"hard":[["nose",0,-0.9,-2.6],["leftWing",-6.14,0.95,-0.5],["rightWing",6.14,0.95,-0.5],["tail",0,-0.12,3.95],["fuselage",0,-0.82,0.3]],"spec":{"mass":1100,"wingArea":16.2,"wingSpan":11,"chord":1.47,"Ixx":1800,"Iyy":2600,"Izz":1300,"CL0":0.25,"CLa":5,"alphaStall":0.29,"CD0":0.044,"k":0.0545,"CYb":-0.31,"Cmalpha":-1.05,"Cmq":-16,"Cmde":-0.75,"Clb":-0.09,"Clp":-0.52,"Clda":0.075,"Cnb":0.083,"Cnr":-0.11,"Cndr":0.009,"thrustMax":3400,"fuelCapacity":160,"fuelBurnMax":0.0105,"gearDragArea":0.55,"maxGearSpeed":74,"vne":82,"propeller":true,"rotor":false,"rotorDrag":0,"rotorPitchArm":1.1,"rotorRollArm":0.85,"rotorYawArm":0.9,"rotorRadius":1.05,"yawDamper":false}},"courier":{"scale":1.08,"eye":[-0.24,0.44,-0.05],"gear":[["nose",0,-1.5336,-1.242,36872.7273,5956.3636,0.216],["left",-1.62,-1.62,0.54,48218.1818,7374.5455,0.2808],["right",1.62,-1.62,0.54,48218.1818,7374.5455,0.2808]],"hard":[["nose",0,-0.972,-2.9765],["leftWing",-6.3936,-0.0216,-0.54],["rightWing",6.3936,-0.0216,-0.54],["tail",0,-0.1296,4.522],["fuselage",0,-0.8856,0.324]],"spec":{"mass":1560,"wingArea":16.9,"wingSpan":11.6,"chord":1.5,"Ixx":2500,"Iyy":3500,"Izz":1850,"CL0":0.22,"CLa":5,"alphaStall":0.28,"CD0":0.031,"k":0.05,"CYb":-0.31,"Cmalpha":-1.05,"Cmq":-16,"Cmde":-0.75,"Clb":-0.09,"Clp":-0.48,"Clda":0.082,"Cnb":0.083,"Cnr":-0.11,"Cndr":0.009,"thrustMax":5400,"fuelCapacity":340,"fuelBurnMax":0.021,"gearDragArea":0.55,"maxGearSpeed":88,"vne":104,"propeller":true,"rotor":false,"rotorDrag":0,"rotorPitchArm":1.1,"rotorRollArm":0.85,"rotorYawArm":0.9,"rotorRadius":1.15,"yawDamper":false}},"meridian":{"scale":2.05,"eye":[-0.3,0.3,-1.5],"gear":[["nose",0,-2.911,-3.485,663000,107100,0.41],["left",-2.7675,-3.075,1.845,867000,132600,0.533],["right",2.7675,-3.075,1.845,867000,132600,0.533]],"hard":[["nose",0,-1.845,-7.1955],["leftWing",-14.391,0,-1.025],["rightWing",14.391,0,-1.025],["tail",0,-0.246,10.9316],["fuselage",0,-1.681,0.615]],"spec":{"mass":16500,"wingArea":78,"wingSpan":26.2,"chord":3,"Ixx":210000,"Iyy":420000,"Izz":160000,"CL0":0.2,"CLa":5.2,"alphaStall":0.26,"CD0":0.023,"k":0.044,"CYb":-0.42,"Cmalpha":-1.3,"Cmq":-24,"Cmde":-0.9,"Clb":-0.12,"Clp":-0.62,"Clda":0.046,"Cnb":0.11,"Cnr":-0.16,"Cndr":0.011,"thrustMax":60000,"fuelCapacity":5200,"fuelBurnMax":0.62,"gearDragArea":2.4,"maxGearSpeed":105,"vne":168,"propeller":false,"rotor":false,"rotorDrag":0,"rotorPitchArm":1.1,"rotorRollArm":0.85,"rotorYawArm":0.9,"rotorRadius":4.2,"yawDamper":true}},"tempest":{"scale":1.75,"eye":[-0.28,0.42,-1.1],"gear":[["nose",0,-2.275,-2.8,510545.4545,82472.7273,0.35],["left",-2.1,-2.3625,1.4,667636.3636,102109.0909,0.455],["right",2.1,-2.3625,1.4,667636.3636,102109.0909,0.455]],"hard":[["nose",0,-1.575,-5.915],["leftWing",-12.985,2.0475,-0.875],["rightWing",12.985,2.0475,-0.875],["tail",0,-0.21,8.9863],["fuselage",0,-1.435,0.525]],"spec":{"mass":13500,"wingArea":74,"wingSpan":24,"chord":3.1,"Ixx":170000,"Iyy":330000,"Izz":130000,"CL0":0.26,"CLa":5,"alphaStall":0.29,"CD0":0.03,"k":0.045,"CYb":-0.52,"Cmalpha":-1.4,"Cmq":-26,"Cmde":-0.85,"Clb":-0.13,"Clp":-0.6,"Clda":0.04,"Cnb":0.12,"Cnr":-0.18,"Cndr":0.012,"thrustMax":42000,"fuelCapacity":4200,"fuelBurnMax":0.5,"gearDragArea":2,"maxGearSpeed":110,"vne":175,"propeller":true,"rotor":false,"rotorDrag":0,"rotorPitchArm":1.1,"rotorRollArm":0.85,"rotorYawArm":0.9,"rotorRadius":1.45,"yawDamper":false}},"harrier":{"scale":1.25,"eye":[-0.22,0.4,-0.9],"gear":[["nose",0,-1.625,-1.25,57200,9240,0.25],["left",-1.4375,-1.6875,0.6875,74800,11440,0.325],["right",1.4375,-1.6875,0.6875,74800,11440,0.325]],"hard":[["nose",0,-1.125,-3.7375],["leftWing",-2.65,-0.1875,-0.625],["rightWing",2.65,-0.1875,-0.625],["tail",0,-0.15,5.6781],["fuselage",0,-1.025,0.375]],"spec":{"mass":2200,"wingArea":3,"wingSpan":3.6,"chord":0.9,"Ixx":4200,"Iyy":6000,"Izz":3000,"CL0":0,"CLa":0.6,"alphaStall":0.6,"CD0":0.09,"k":0.09,"CYb":-0.36,"Cmalpha":-0.45,"Cmq":-12,"Cmde":-0.62,"Clb":-0.05,"Clp":-0.42,"Clda":0.065,"Cnb":0.045,"Cnr":-0.09,"Cndr":0.022,"thrustMax":1,"fuelCapacity":420,"fuelBurnMax":0.035,"gearDragArea":0.2,"maxGearSpeed":200,"vne":140,"rotorPitchArm":0.33,"rotorRollArm":0.45,"rotorYawArm":0.79,"rotorDrag":260,"propeller":false,"rotor":true,"rotorRadius":4.2,"yawDamper":false}}};

/* ------------------------------------------------------------------ */

const results = [];
const ok = (name, pass, detail = '') => {
  results.push({ name, pass: !!pass, detail: String(detail) });
  return !!pass;
};

const r4 = (n) => Math.round(n * 1e4) / 1e4;
const deg = (r) => (r * 180) / Math.PI;

function visibleMeshes(root) {
  const out = [];
  root.updateMatrixWorld(true);
  root.traverse((o) => {
    if (!o.isMesh) return;
    for (let p = o; p; p = p.parent) if (!p.visible) return;
    out.push(o);
  });
  return out;
}

function trianglesOf(root) {
  let n = 0;
  for (const o of visibleMeshes(root)) {
    const g = o.geometry;
    n += ((g.index ? g.index.count : g.attributes.position.count) / 3) * (o.isInstancedMesh ? o.count : 1);
  }
  return n;
}

/** Every visible vertex in world space: cb(v, mesh). */
function eachVertex(root, cb, filter = () => true) {
  const v = new THREE.Vector3();
  const inst = new THREE.Matrix4();
  const M = new THREE.Matrix4();
  for (const o of visibleMeshes(root)) {
    if (!filter(o)) continue;
    const p = o.geometry.attributes.position;
    const copies = o.isInstancedMesh ? o.count : 1;
    for (let k = 0; k < copies; k++) {
      if (o.isInstancedMesh) {
        o.getMatrixAt(k, inst);
        M.multiplyMatrices(o.matrixWorld, inst);
      } else M.copy(o.matrixWorld);
      for (let i = 0; i < p.count; i++) cb(v.fromBufferAttribute(p, i).applyMatrix4(M), o);
    }
  }
}

function nanCount(root) {
  let bad = 0;
  root.traverse((o) => {
    const g = o.geometry;
    if (g) {
      for (const name of ['position', 'normal', 'uv']) {
        const a = g.attributes[name];
        if (!a) continue;
        for (let i = 0; i < a.array.length; i++) if (!Number.isFinite(a.array[i])) bad++;
      }
    }
    for (const e of o.matrixWorld.elements) if (!Number.isFinite(e)) bad++;
  });
  return bad;
}

function signedVolume(geo, groupIndex = null) {
  const p = geo.attributes.position;
  const idx = geo.index.array;
  let s0 = 0;
  let s1 = idx.length;
  if (groupIndex !== null && geo.groups.length) {
    s0 = geo.groups[groupIndex].start;
    s1 = s0 + geo.groups[groupIndex].count;
  }
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  let v = 0;
  for (let i = s0; i < s1; i += 3) {
    a.fromBufferAttribute(p, idx[i]);
    b.fromBufferAttribute(p, idx[i + 1]);
    c.fromBufferAttribute(p, idx[i + 2]);
    v += a.dot(b.cross(c)) / 6;
  }
  return v;
}

const isSpinning = (o) => {
  for (let p = o; p; p = p.parent) if (/propeller|rotor/.test(p.name)) return true;
  return false;
};
const isGear = (o) => {
  for (let p = o; p; p = p.parent) if (/gear/.test(p.name)) return true;
  return false;
};

/** Where the follow camera sits at rest: 17 m behind, 5.2 m up (camera.js). */
const CHASE = new THREE.Vector3(0, 5.2, 17);
/** The pilot's eye in the model frame, metres. */
const eyeAt = (S) => new THREE.Vector3(S.eye[0] * S.scale, S.eye[1] * S.scale, S.eye[2] * S.scale);

const REST = (over = {}) => ({
  controls: { pitch: 0, roll: 0, yaw: 0, throttle: 0, brakes: 0, ...(over.controls || {}) },
  rpm: 0,
  flaps: 0,
  gearPos: 1,
  gearDown: true,
  onGround: true,
  groundSpeed: 0,
  agl: 0,
  engineOn: false,
  ...over,
  ...(over.controls ? { controls: { pitch: 0, roll: 0, yaw: 0, throttle: 0, brakes: 0, ...over.controls } } : {}),
});

/**
 * How far a blur disc darkens a white sky behind it, in levels of 255, at
 * the thinnest part of its swept area (just inside the tip ring), seen from
 * `camPos` (model frame, metres). Reads the disc's own fade for that camera
 * (civil-build.js, thinWhenNear) and the alpha its texture was drawn with.
 * An additive disc cannot darken anything, and adding its light to a white
 * sky changes nothing — which is exactly how the Skyhook's rotor went
 * missing — so it scores 0.
 */
function discDarkening(model, disc, camPos) {
  model.updateMatrixWorld(true);
  const cam = new THREE.PerspectiveCamera();
  cam.position.copy(camPos);
  cam.updateMatrixWorld(true);
  if (disc.onBeforeRender) disc.onBeforeRender(null, null, cam, disc.geometry, disc.material, null);
  const m = disc.material;
  const u = (m.map && m.map.userData) || {};
  if (!disc.visible || m.blending !== THREE.NormalBlending || !(u.minAlpha > 0)) return { levels: 0, opacity: m.opacity };
  return { levels: u.minAlpha * m.opacity * (1 - (u.luminance ?? 1)) * 255, opacity: m.opacity };
}

/** World position of a surface's trailing-edge vertex (max local z). */
function trailingEdge(obj) {
  const mesh = obj.children[0];
  const p = mesh.geometry.attributes.position;
  let best = 0;
  for (let i = 1; i < p.count; i++) if (p.getZ(i) > p.getZ(best)) best = i;
  obj.updateMatrixWorld(true);
  return new THREE.Vector3().fromBufferAttribute(p, best).applyMatrix4(mesh.matrixWorld);
}

/* ------------------------------------------------------------------ */

for (const id of IDS) {
  const type = getAircraft(id);
  const S = type.shape;
  const spec = specFor(id);
  const base = BASE[id];

  /* The flight model, against 0db28ca. */
  ok(`${id}: scale unchanged`, S.scale === base.scale, S.scale);
  ok(`${id}: eye unchanged`, JSON.stringify(S.eye) === JSON.stringify(base.eye), JSON.stringify(S.eye));
  const gear = spec.gearPoints.map((g) => [g.name, r4(g.pos.x), r4(g.pos.y), r4(g.pos.z), r4(g.k), r4(g.c), r4(g.travel)]);
  ok(`${id}: gear contact points, springs and travel unchanged from 0db28ca`, JSON.stringify(gear) === JSON.stringify(base.gear), JSON.stringify(gear));
  const hard = spec.hardPoints.map((g) => [g.part, r4(g.pos.x), r4(g.pos.y), r4(g.pos.z)]);
  ok(`${id}: strike points unchanged from 0db28ca`, JSON.stringify(hard) === JSON.stringify(base.hard), JSON.stringify(hard));
  const diffs = [];
  for (const [k, v] of Object.entries(base.spec)) {
    const now = typeof spec[k] === 'number' ? r4(spec[k]) : spec[k];
    if (now !== v) diffs.push(`${k} ${v} -> ${now}`);
  }
  ok(`${id}: every flight-spec number unchanged from 0db28ca`, diffs.length === 0, diffs.join('; ') || 'identical');

  /* It builds, through the adapter, from its own airframe. */
  ok(`${id}: the fleet pack does not draw it by default`, !adapter.fleetCovers(id));
  let model = null;
  try {
    model = adapter.createAircraftModel({ type, livery: schemeFor(type, 'house') });
  } catch (e) {
    ok(`${id}: builds`, false, e && e.stack);
    continue;
  }
  ok(`${id}: builds from its own civil airframe, not the fallback`, model.userData.civil === id, model.userData.civil);
  let painted = null;
  try {
    painted = adapter.createAircraftModel({ type, livery: findLivery('liberty') });
  } catch (e) {
    painted = e;
  }
  ok(`${id}: builds in an airline livery with a coloured tail`, painted && painted.isObject3D && painted.userData.civil === id, painted && painted.message);
  /* One landing light for the one you fly; none for one that is parked. */
  {
    const lights = (o) => { let n = 0; o.traverse((c) => { if (c.isLight) n++; }); return n; };
    let parked = null;
    try {
      parked = adapter.createAircraftModel({ type, livery: schemeFor(type, 'house'), landingLight: false });
      parked.userData.update(0.016, REST({ engineOn: true, rpm: 0.5 }), { isNight: true });
    } catch (e) {
      parked = e;
    }
    ok(`${id}: one landing light when flown, none when built parked`, lights(model) === 1 && parked && parked.isObject3D && lights(parked) === 0,
      `${lights(model)} flown, ${parked && parked.isObject3D ? lights(parked) : parked && parked.message} parked`);
  }

  model.updateMatrixWorld(true);
  ok(`${id}: no NaN in any vertex, normal, uv or transform`, nanCount(model) === 0, nanCount(model));
  const tris = trianglesOf(model);
  ok(`${id}: under the triangle budget (${TRI_BUDGET})`, tris <= TRI_BUDGET, `${tris} triangles`);
  {
    // Running, the blur discs are drawn and (past spool-up) the blades are not.
    for (let i = 0; i < 6; i++) model.userData.update(1, REST({ engineOn: true, rpm: 1, onGround: false, agl: 300, gearPos: 0, gearDown: false }), null);
    const run = trianglesOf(model);
    ok(`${id}: under the triangle budget with the engine running`, run <= TRI_BUDGET, `${run} triangles`);
    for (let i = 0; i < 12; i++) model.userData.update(1, REST(), null);
  }
  ok(`${id}: model scaled by shape.scale`, Math.abs(model.scale.x - S.scale) < 1e-9, model.scale.x);

  /* Windows are the hull's own quads, and the hull is wound outward. */
  const hulls = [];
  model.traverse((o) => o.isMesh && Array.isArray(o.material) && hulls.push(o));
  const main = hulls.find((o) => o.name === 'fuselage');
  ok(`${id}: fuselage has glass in its own grid`, main && main.geometry.groups.length === 2 && main.geometry.groups[1].count > 0, main && JSON.stringify(main.geometry.groups));
  ok(`${id}: fuselage wound outward`, main && signedVolume(main.geometry) > 0, main && signedVolume(main.geometry).toFixed(3));
  const surf = model.userData.parts.surfaces;
  const badSurf = surf.filter((s) => signedVolume(s.obj.children[0].geometry) <= 0).map((s) => s.kind);
  ok(`${id}: control surfaces wound outward`, badSurf.length === 0, badSurf.join(',') || `${surf.length} surfaces`);

  /*
   * No part lit as if it faced the nose. hull() fell back to a normal of
   * (0, 0, +-1) whenever its finite-difference cross product was under an
   * absolute 1e-12, which every part under about 0.35 m across was: the
   * Skylark's spats, the Tempest's nacelles and sponsons, the Skyhook's boom,
   * every tail cone's last metre — 82 to 730 triangles an aeroplane. And
   * hull() winds each triangle by its vertex normals, so it also turned 10
   * of the 320 in each Skylark spat inward: holes with the tyre showing
   * through. A triangle whose three normals are all exactly +-Z while its
   * own face is side-on is that fallback and nothing else.
   */
  {
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), f = new THREE.Vector3(), t = new THREE.Vector3();
    let zLit = 0;
    const where = new Set();
    for (const o of visibleMeshes(model)) {
      const g = o.geometry;
      const p = g.attributes.position;
      const nr = g.attributes.normal;
      if (!g.index || !nr) continue;
      const idx = g.index.array;
      for (let i = 0; i < idx.length; i += 3) {
        a.fromBufferAttribute(p, idx[i]);
        b.fromBufferAttribute(p, idx[i + 1]);
        c.fromBufferAttribute(p, idx[i + 2]);
        f.subVectors(b, a).cross(t.subVectors(c, a));
        if (f.lengthSq() < 1e-16 || Math.abs(f.normalize().z) > 0.7) continue;
        let z = 0;
        for (let k = 0; k < 3; k++) if (Math.abs(nr.getZ(idx[i + k])) > 0.9999) z++;
        if (z === 3) {
          zLit++;
          where.add(o.name || o.parent.name);
        }
      }
    }
    ok(`${id}: every side-on face is lit by its own normals, not the (0,0,1) fallback`, zLit === 0, zLit ? `${zLit} in ${[...where].join(', ')}` : '0');
  }

  /* Nothing named so groundOffsetFor() would move the picture. */
  ok(`${id}: groundOffsetFor leaves it where the gear puts it`, adapter.groundOffsetFor(model, spec) === 0, adapter.groundOffsetFor(model, spec));

  /* The drawn contact: tyres (skids) on the contact points. */
  const [gN, gL, gR] = spec.gearPoints.map((g) => g.pos);
  for (const g of spec.gearPoints) {
    const xs = id === 'harrier' && g.name === 'nose' ? [gL.x, gR.x] : [g.pos.x];
    let low = Infinity;
    eachVertex(model, (v) => {
      if (Math.abs(v.z - g.pos.z) > 0.12 * S.scale) return;
      if (!xs.some((x) => Math.abs(v.x - x) < 0.35 * S.scale)) return;
      if (v.y < low) low = v.y;
    }, (o) => !isSpinning(o));
    ok(`${id}: drawn ${g.name} contact within 3 cm of the physics point`, Math.abs(low - g.pos.y) <= 0.03, `drawn ${low.toFixed(3)} vs ${g.pos.y.toFixed(3)} m`);
  }

  /* Nothing below the ground the three contact points define. */
  const plane = new THREE.Plane().setFromCoplanarPoints(gN, gR, gL);
  if (plane.normal.y < 0) plane.negate();
  let deepest = Infinity;
  let deepestAt = null;
  eachVertex(model, (v) => {
    const d = plane.distanceToPoint(v);
    if (d < deepest) {
      deepest = d;
      deepestAt = v.clone();
    }
  });
  ok(`${id}: nothing drawn below the runway`, deepest >= -0.03, `lowest ${deepest.toFixed(3)} m at ${deepestAt && deepestAt.toArray().map((n) => n.toFixed(2)).join(',')}`);

  /* Tail strike: the drawing must not touch before the physics does. */
  {
    const tail = spec.hardPoints.find((p) => p.part === 'tail').pos;
    const mc = gR.clone().setX(0);
    const gz = mc.z - gN.z;
    const gy = mc.y - gN.y;
    const ang = (z, y) => Math.atan2(gz * (y - mc.y) - gy * (z - mc.z), gz * (z - mc.z) + gy * (y - mc.y));
    const phys = ang(tail.z, tail.y);
    let first = Infinity;
    let firstAt = null;
    eachVertex(model, (v) => {
      if (v.z < mc.z + 0.3) return;
      const a = ang(v.z, v.y);
      if (a < first) {
        first = a;
        firstAt = v.clone();
      }
    });
    ok(`${id}: drawn tail reaches the runway no sooner than the tail-strike point`, first >= phys - (1 * Math.PI) / 180, `drawn ${deg(first).toFixed(1)} deg at z ${firstAt && firstAt.z.toFixed(2)}, physics ${deg(phys).toFixed(1)} deg`);
  }

  /*
   * No daylight between the wing root and the body. The Skylark's roof fell
   * away under the back half of its wing and down both sides of it, so from
   * the side and from the front there was sky between the cabin and the wing
   * — a wing floating on the aeroplane — and nothing above measured it. Level
   * rays from the right, across the root chord and a band of heights round
   * the wing: one that meets nothing while the rays above and below it at
   * the same station both hit is a slot you can see through.
   */
  if (id !== 'harrier') {
    const meshes = visibleMeshes(model).filter((o) => !isSpinning(o) && !isGear(o));
    const sides = new Map();
    for (const o of meshes) for (const mt of [].concat(o.material)) if (!sides.has(mt)) sides.set(mt, mt.side);
    for (const mt of sides.keys()) mt.side = THREE.DoubleSide;
    const rc = new THREE.Raycaster();
    const s = S.scale;
    const slots = [];
    const from = new THREE.Vector3();
    const left = new THREE.Vector3(-1, 0, 0);
    const reach = (S.wingRootX + 1) * s;
    for (let z = (S.wingZ + 0.02) * s; z <= (S.wingZ + S.rootChord - 0.02) * s; z += 0.03 * s) {
      const col = [];
      for (let y = (S.wingY - 0.45) * s; y <= (S.wingY + 0.25) * s; y += 0.01 * s) {
        rc.set(from.set(50, y, z), left);
        // Only what the ray meets near the body counts: sky between the
        // cabin and, say, a jet's exhaust plug three metres out is air.
        col.push(rc.intersectObjects(meshes, false).some((h) => Math.abs(h.point.x) < reach));
      }
      const a = col.indexOf(true);
      const b = col.lastIndexOf(true);
      let run = 0;
      for (let i = a; a >= 0 && i <= b; i++) {
        if (!col[i]) run++;
        else {
          if (run >= 2) slots.push(`z ${(z / s).toFixed(2)}: ${Math.round(run * s)} cm tall`);
          run = 0;
        }
      }
    }
    for (const [mt, side] of sides) mt.side = side;
    ok(`${id}: no daylight between the wing root and the body`, slots.length === 0, slots.slice(0, 4).join('; ') || 'none');
  }

  /* Wing strike: nothing outboard of the wheels scrapes before the tip. */
  if (id !== 'harrier') {
    const tip = spec.hardPoints.find((p) => p.part === 'rightWing').pos;
    const phys = Math.atan2(tip.y - gR.y, tip.x - gR.x);
    let first = Infinity;
    let firstAt = null;
    eachVertex(model, (v) => {
      const x = Math.abs(v.x);
      if (x < gR.x + 0.3) return;
      const a = Math.atan2(v.y - gR.y, x - gR.x);
      if (a < first) {
        first = a;
        firstAt = v.clone();
      }
    }, (o) => !isSpinning(o) && !isGear(o));
    /*
     * Propellers are left out on purpose. A twin's wing-mounted discs reach
     * lower than its wing tip — the Tempest's touch at 12.7 degrees of bank
     * against the tip's 22 — and the flight model has no propeller-strike
     * point to match them to. That is a physics question, not a drawing one.
     */
    ok(`${id}: nothing outboard scrapes at a lower bank than the wing tip`, first >= phys - (1 * Math.PI) / 180, `drawn ${deg(first).toFixed(1)} deg at x ${firstAt && firstAt.x.toFixed(2)}, wing tip ${deg(phys).toFixed(1)} deg`);
  }

  /* Moving parts move the right way. */
  const P = model.userData.parts;
  const up = model.userData.update;
  const kinds = (k) => P.surfaces.filter((s) => s.kind === k);
  if (id !== 'harrier') {
    const probe = (kind, controls, flaps, axis, sign) => {
      const list = kinds(kind);
      if (!list.length) return ok(`${id}: has a ${kind}`, false);
      up(1, REST({ controls: {} }), null);
      const before = list.map((s) => trailingEdge(s.obj));
      up(1, REST({ controls, flaps }), null);
      const after = list.map((s) => trailingEdge(s.obj));
      const moved = after.map((a, i) => (a[axis] - before[i][axis]) * sign);
      up(1, REST({ controls: {} }), null);
      return ok(`${id}: ${kind} trailing edge moves ${sign > 0 ? '+' : '-'}${axis} for ${JSON.stringify(controls)}${flaps ? ' flaps ' + flaps : ''}`, moved.every((d) => d > 0.02), moved.map((d) => d.toFixed(3)).join(','));
    };
    probe('elevator', { pitch: 1 }, 0, 'y', 1); // stick back: trailing edge up
    probe('rudder', { yaw: 1 }, 0, 'x', 1); // right pedal: trailing edge right
    probe('aileronL', { roll: 1 }, 0, 'y', -1); // roll right: left aileron down
    probe('aileronR', { roll: 1 }, 0, 'y', 1); // ...right aileron up
    probe('flap', {}, 1, 'y', -1);
    if (S.power.kind === 'jet') {
      // Jets: the nozzles warm with power.
      up(0.1, REST({ rpm: 0 }), null);
      const cold = P.nozzles.every((mat) => mat.emissiveIntensity === 0);
      up(0.1, REST({ rpm: 1, engineOn: true }), null);
      const hot = P.nozzles.every((mat) => mat.emissiveIntensity > 1);
      ok(`${id}: jet nozzles cold at rest, glowing at full power`, P.nozzles.length > 0 && cold && hot, `${P.nozzles.length} nozzle materials`);
    } else {
      // Propellers: blades at rest, blur disc at power.
      up(0.1, REST({ rpm: 0 }), null);
      const bladesRest = P.props.every((p) => p.spin.visible && !p.disc.visible);
      up(0.1, REST({ rpm: 1, engineOn: true }), null);
      const discRun = P.props.every((p) => !p.spin.visible && p.disc.visible);
      ok(`${id}: propeller blades at rest, blur disc at full power`, P.props.length === S.power.count && bladesRest && discRun, `${P.props.length} propellers`);
      // ...and the disc is there to see from outside, and thin from the seat.
      const chase = P.props.map((p) => discDarkening(model, p.disc, CHASE));
      const seat = P.props.map((p) => discDarkening(model, p.disc, eyeAt(S)));
      ok(`${id}: at full power the propeller disc can be seen from the chase view`, chase.every((d) => d.levels >= 30),
        `darkens a white sky by ${chase.map((d) => d.levels.toFixed(0)).join(', ')} levels (the additive disc it replaced: 0)`);
      if (S.power.count === 1) {
        ok(`${id}: from the cockpit the pilot looks through the propeller disc`, seat.every((d, i) => d.opacity <= chase[i].opacity * 0.2),
          `opacity ${seat.map((d) => d.opacity.toFixed(2)).join(', ')} at the eye, ${chase.map((d) => d.opacity.toFixed(2)).join(', ')} from the chase view`);
      }
      const spun = P.props.map((p) => p.spin.rotation.z);
      up(1 / 30, REST({ rpm: 0.18, engineOn: true }), null);
      const perFrame = P.props.map((p, i) => Math.abs(Math.atan2(Math.sin(p.spin.rotation.z - spun[i]), Math.cos(p.spin.rotation.z - spun[i]))));
      const halves = P.props.map((p) => Math.PI / p.blades);
      ok(`${id}: at idle the drawn propeller turns less than half a blade a frame at 30 fps`, perFrame.every((a, i) => a > 0.05 && a < halves[i]),
        `${perFrame.map((a) => deg(a).toFixed(0)).join(', ')} deg a frame (half a blade: ${halves.map((h) => deg(h).toFixed(0)).join(', ')})`);
    }
  } else {
    // Rotor: spools up over a few seconds, blades give way to the disc.
    const R = P.rotor;
    ok(`${id}: has a main rotor of the physics' radius`, R && Math.abs(R.coners.length - 4) === 0, R && R.coners.length);
    up(0.016, REST({ engineOn: false }), null);
    const droop = R.coners[0].rotation.z;
    const still = R.blades.visible && !R.disc.visible && droop < 0;
    for (let i = 0; i < 8; i++) up(1, REST({ engineOn: true, rpm: 0.5 }), null);
    const coned = R.coners[0].rotation.z > 0;
    ok(`${id}: rotor droops at rest and cones up when running`, still && coned, `blade angle ${droop.toFixed(3)} at rest, ${R.coners[0].rotation.z.toFixed(3)} running`);
    /*
     * And a running rotor can be SEEN. At 93375df this check asserted the
     * blades hidden and the disc on — and the disc was additive and pale, so
     * the chase view on the runway and in the hover showed a hub and no
     * rotor (the reviewer measured 5 levels of 255 between frames with and
     * without it). Now: either the blades are drawn, or the disc darkens a
     * white sky by 50 levels or more at its thinnest, seen from where the
     * chase camera sits. tests/features/civil.browser.js measures the same
     * thing in real pixels.
     */
    const seen = (label, st) => {
      for (let i = 0; i < 6; i++) up(1, REST(st), null);
      const d = discDarkening(model, R.disc, CHASE);
      const t = discDarkening(model, R.tailDisc, CHASE);
      const pass = (R.blades.visible || d.levels >= 50) && (R.tailBlades.visible || t.levels >= 30);
      ok(`${id}: running rotor can be seen ${label}`, pass,
        `blades ${R.blades.visible ? 'drawn' : 'hidden'}, disc darkens a white sky by ${d.levels.toFixed(0)} levels; tail disc ${t.levels.toFixed(0)}; spool ${P.spool.toFixed(2)}`);
      return d;
    };
    seen('on the ground at idle', { engineOn: true, rpm: 0.18 });
    seen('in the hover', { engineOn: true, rpm: 0.5, onGround: false, agl: 32 });
    const climb = seen('at full collective', { engineOn: true, rpm: 1, onGround: false, agl: 300 });
    const inside = discDarkening(model, R.disc, eyeAt(S));
    ok(`${id}: from the cabin the rotor disc thins but does not vanish`, inside.opacity > 0.2 && inside.opacity <= climb.opacity * 0.45,
      `opacity ${inside.opacity.toFixed(2)} at the eye, ${climb.opacity.toFixed(2)} from the chase view`);
    {
      const a0 = R.spin.rotation.y;
      up(1 / 30, REST({ engineOn: true, rpm: 0.5, onGround: false, agl: 32 }), null);
      const da = Math.abs(Math.atan2(Math.sin(R.spin.rotation.y - a0), Math.cos(R.spin.rotation.y - a0)));
      const half = Math.PI / R.coners.length;
      ok(`${id}: the drawn rotor turns less than half a blade a frame at 30 fps`, da > 0.05 && da < half, `${deg(da).toFixed(0)} deg a frame (half a blade: ${deg(half).toFixed(0)})`);
    }
    /*
     * Measured on the drawing, not on the sign of an angle. This asserted
     * `rotation.x > 0` for stick forward and passed — while a positive turn
     * about X lifts the FRONT of the disc, so pushing forward tipped it back.
     * controls.pitch is +1 for stick back (input.js, pitchUp).
     */
    const lean = (controls) => {
      for (let i = 0; i < 4; i++) up(1, REST({ engineOn: true, rpm: 0.5, onGround: false, controls }), null);
      R.head.updateMatrixWorld(true);
      const at = (x, z) => new THREE.Vector3(x, 0, z).applyMatrix4(R.head.matrixWorld).y;
      return { frontDown: at(0, 3) - at(0, -3), rightDown: at(-3, 0) - at(3, 0) };
    };
    const fwd = lean({ pitch: -1 });
    const back = lean({ pitch: 1 });
    const right = lean({ roll: 1 });
    ok(`${id}: rotor disc tips forward for stick forward, back for stick back`, fwd.frontDown > 0.1 && back.frontDown < -0.1, `front lower by ${fwd.frontDown.toFixed(3)} m / ${back.frontDown.toFixed(3)} m`);
    ok(`${id}: rotor disc tips right for stick right`, right.rightDown > 0.1, `right side lower by ${right.rightDown.toFixed(3)} m`);
    // And the rotor itself: does its tip clear the tail?
    let tipZ = -Infinity;
    const tr = model.getObjectByName('tail rotor');
    tr.updateMatrixWorld(true);
    const trFront = new THREE.Box3().setFromObject(tr).min.z;
    tipZ = (S.power.z + S.power.propRadius) * S.scale;
    ok(`${id}: tail rotor sits outside the main rotor's reach`, trFront > tipZ, `tail rotor front ${trFront.toFixed(2)} m, main rotor reaches ${tipZ.toFixed(2)} m`);
  }

  /* Gear: retractables fold away; fixed gear stays put. */
  up(1, REST({ gearPos: 0, gearDown: false, onGround: false }), null);
  const legsUp = P.gear.legs.map((l) => l.leg.visible);
  up(1, REST({ gearPos: 1 }), null);
  const legsDown = P.gear.legs.map((l) => l.leg.visible);
  if (S.retractable) ok(`${id}: gear retracts out of sight and comes back`, legsUp.every((v) => !v) && legsDown.every((v) => v), `up ${legsUp} down ${legsDown}`);
  else ok(`${id}: fixed gear stays down`, legsUp.every((v) => v), `${legsUp}`);

  /* Wheels roll and the nose wheel steers. */
  if (P.gear.wheels.length) {
    const w0 = P.gear.wheels[0].obj.rotation.x;
    up(0.1, REST({ groundSpeed: 10, controls: { yaw: 1 } }), null);
    const rolled = P.gear.wheels[0].obj.rotation.x !== w0;
    const steered = P.gear.steer.length === 0 || P.gear.steer.every((s) => Math.abs(s.rotation.y + 0.5 * (1 - 10 / 40)) < 1e-6);
    ok(`${id}: wheels roll and the nose wheel steers with the pedals`, rolled && steered, `rolled ${rolled}, steer ${P.gear.steer.map((s) => s.rotation.y.toFixed(3))}`);
  }

  /*
   * Standing on its springs. The flight model's gear points are at full
   * extension and it settles with them pressed into the runway — in the game
   * the Skylark's lowest point measured 0.129 m under the tarmac and the
   * Skyhook's skids 0.159 m. Given the pose (level, the ground 0.1 m above the
   * main contact points, as the springs leave it), the drawn gear has to give
   * by as much: nothing under the ground, and something on it.
   */
  {
    const s = S.scale;
    const groundY = gR.y + 0.1;
    const pose = REST({ onGround: true });
    pose.pos = new THREE.Vector3(0, 0, 0);
    pose.quat = new THREE.Quaternion();
    pose.agl = -groundY;
    up(0.016, pose, null);
    model.updateMatrixWorld(true);
    let low = Infinity;
    eachVertex(model, (v) => { if (v.y < low) low = v.y; }, (o) => !isSpinning(o));
    ok(`${id}: standing, the gear gives with the springs — on the runway, not in it`, low >= groundY - 0.02 && low <= groundY + 0.03,
      `lowest ${(low - groundY).toFixed(3)} m from the ground (${(gR.y - groundY).toFixed(3)} without giving)`);
    up(0.016, REST({ onGround: false, gearPos: 1 }), null);
  }

  /* The apron's half-empty state must not produce NaN. */
  up(0.016, { controls: { pitch: 0, roll: 0, yaw: 0, throttle: 0, brakes: 1 }, rpm: 0, flaps: 0, gearPos: 1, gearDown: true, onGround: true, groundSpeed: 0, agl: 0, engineOn: false }, { isNight: false, cond: { cloud: 0 } });
  up(0.016, {}, undefined);
  up(0.016, { controls: {} }, { isNight: true });
  model.updateMatrixWorld(true);
  ok(`${id}: update() with a sparse state leaves no NaN`, nanCount(model) === 0, nanCount(model));
}

/*
 * The generic factory still builds everything it is the fallback for: the
 * three military types if the pack fails to load, and each civil shape if its
 * own airframe ever throws (model.js catches that and draws the generic one).
 * A civil shape is sent there under an id CIVIL does not know.
 */
for (const id of IDS) {
  let m = null;
  try {
    m = legacy.createAircraftModel({ type: { ...getAircraft(id), id: `${id}-fallback` } });
    m.updateMatrixWorld(true);
  } catch (e) {
    m = e;
  }
  ok(`generic factory still builds the ${id} shape as a fallback`, m && m.isObject3D && !m.userData.civil && nanCount(m) === 0, m && m.message);
}
for (const id of ['vanguard', 'osprey', 'nightjar']) {
  let m = null;
  try {
    m = legacy.createAircraftModel({ type: getAircraft(id) });
    m.updateMatrixWorld(true);
  } catch (e) {
    m = e;
  }
  ok(`generic factory still builds ${id}`, m && m.isObject3D && nanCount(m) === 0, m && m.message);
}

/* ------------------------------------------------------------------ */

const failed = results.filter((r) => !r.pass);
for (const r of results) console.log(`${r.pass ? 'ok  ' : 'FAIL'}  ${r.name}${r.detail ? '  — ' + r.detail : ''}`);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) process.exitCode = 1;

/**
 * Node checks for getting out and walking about, and for the ramp crew.
 *
 *   node tests/features/onfoot.mjs
 *
 * Imports every module of the two features for real (a link error fails
 * here, which `node --check` would not catch), then drives the parts that do
 * not need a page: the walker against real terrain and made-up walls, the
 * people and the vehicles as built, the vehicle specs as driven by the
 * game's own SurfaceVehicle, the pushback / docking / marshalling arithmetic,
 * and the on-foot plug-in itself against a stand-in for the game.
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

const ROOT = new URL('../../src/', import.meta.url).href;
const results = [];
function ok(name, pass, detail = '') {
  results.push({ name, pass: !!pass, detail: String(detail) });
}

const THREE = await import(ROOT + 'vendor/three.module.js');
const mods = {};
for (const m of [
  'features/staff/person.js', 'features/staff/walk.js', 'features/staff/models.js', 'features/staff/jobs.js',
  'features/staff/ui.js', 'features/staff/vehicles.js', 'features/onfoot.js', 'features/staff.js',
]) {
  try {
    mods[m] = await import(ROOT + m);
    ok(`imports ${m}`, true);
  } catch (e) {
    ok(`imports ${m}`, false, e && e.stack);
  }
}
const P = mods['features/staff/person.js'];
const W = mods['features/staff/walk.js'];
const M = mods['features/staff/models.js'];
const J = mods['features/staff/jobs.js'];
const V = mods['features/staff/vehicles.js'];
const OF = mods['features/onfoot.js'];
const TERR = await import(ROOT + 'world/terrain.js');
const SURF = await import(ROOT + 'vehicles/surface.js');
const EXT = await import(ROOT + 'game/extensions.js');
const TYPES = await import(ROOT + 'aircraft/types.js');
const MA = await import(ROOT + 'aircraft/model-adapter.js');

const near = (a, b, tol) => Math.abs(a - b) <= tol;
// The game applies the map at boot; until then heightAt is NaN out at sea.
TERR.applyMap(TERR.MAP.id);

/* ---------------------------------------------------------------- */
/* The plug-ins registered                                          */
/* ---------------------------------------------------------------- */
{
  const st = EXT.extStatus();
  ok('both plug-ins registered', ['onfoot', 'staff'].every((id) => st.some((e) => e.id === id && e.live)), JSON.stringify(st));
  const acts = EXT.extDevActions();
  ok('the Dev panel gets "Work at the airport"', acts.some((a) => a.label === 'Work at the airport' && a.ext === 'staff'), acts.map((a) => a.label).join(', '));
}

/* ---------------------------------------------------------------- */
/* People                                                            */
/* ---------------------------------------------------------------- */
if (P) {
  for (const outfit of ['pilot', 'staff', 'passenger']) {
    const p = P.createPerson({ outfit, seed: 3 });
    p.updateMatrixWorld(true);
    const b = new THREE.Box3();
    let meshes = 0;
    p.traverse((o) => {
      if (o.isMesh && o.visible) {
        meshes++;
        b.union(new THREE.Box3().setFromObject(o));
      }
    });
    ok(`${outfit}: feet on the ground`, near(b.min.y, 0, 0.01), `soles at ${b.min.y.toFixed(3)} m`);
    ok(`${outfit}: about 1.7 m tall`, b.max.y > 1.6 && b.max.y < 1.85, `${b.max.y.toFixed(2)} m`);
    ok(`${outfit}: eleven draw calls`, meshes === 11, `${meshes}`);
    let bad = false;
    for (const wave of [null, 'come', 'stop', 'left', 'right', 'hello']) {
      for (let i = 0; i < 30; i++) P.posePerson(p, 1 / 30, { speed: i % 7, air: i % 11 === 0, wave });
      p.traverse((o) => {
        if (!Number.isFinite(o.rotation.x + o.rotation.z + o.position.y)) bad = true;
      });
    }
    ok(`${outfit}: every pose is finite`, !bad);
  }
  const lite = P.createPerson({ outfit: 'passenger', lite: true, suitcase: true, seed: 9 });
  let m = 0;
  lite.traverse((o) => { if (o.isMesh) m++; });
  ok('a passenger is five draw calls', m === 5, `${m}`);
}

/* ---------------------------------------------------------------- */
/* Vehicles                                                          */
/* ---------------------------------------------------------------- */
if (M && V) {
  for (const id of V.STAFF_IDS) {
    const g = M.BUILDERS[id]();
    const info = g.userData.staff;
    g.updateMatrixWorld(true);
    const b = new THREE.Box3().setFromObject(g);
    let meshes = 0;
    g.traverse((o) => { if (o.isMesh) meshes++; });
    ok(`${id}: built, with its sizes`, info && info.kind === id && info.halfLength > 1 && info.halfWidth > 0.5, JSON.stringify(info && { hl: info.halfLength, hw: info.halfWidth }));
    ok(`${id}: wheels on the ground`, near(b.min.y, 0, 0.02), `${b.min.y.toFixed(3)}`);
    ok(`${id}: no wider than it says`, b.max.x <= info.halfWidth + 0.12 && -b.min.x <= info.halfWidth + 0.12, `${b.min.x.toFixed(2)}..${b.max.x.toFixed(2)} vs ${info.halfWidth}`);
    ok(`${id}: a few draw calls`, meshes <= 5, `${meshes}`);
    const spec = SURF.VEHICLES[id];
    ok(`${id}: registered in VEHICLES as a staff car`, spec && spec.id === id && spec.kind === 'car' && spec.staff === true, JSON.stringify(spec && { id: spec.id, kind: spec.kind }));
    ok(`${id}: spec and model agree on size`, spec && near(spec.halfLength, info.halfLength, 0.01) && near(spec.halfWidth, info.halfWidth, 0.01));
  }
  const stairs = M.createStairTruck();
  M.setLift(stairs, 3.4);
  stairs.updateMatrixWorld(true);
  const plat = stairs.userData.staff.platform;
  ok('the stair platform rises to the height asked', near(plat.getWorldPosition(new THREE.Vector3()).y, 3.4, 0.01));
  ok('the stairs will not rise past what they can', M.setLift(stairs, 99) === stairs.userData.staff.liftMax);
  const cat = M.createCateringTruck();
  M.setLift(cat, 3);
  ok('the catering box lifts', near(cat.userData.staff.lift.position.y, 3, 0.01));
  ok('registering twice keeps one set', V.registerStaffVehicles().length === 4 && Object.keys(SURF.VEHICLES).filter((k) => SURF.VEHICLES[k].staff).length === 4);
  const other = { car: SURF.VEHICLES.car, tug: { id: 'tug', name: 'somebody else' } };
  V.registerStaffVehicles(other);
  ok('a vehicle of the same name from somebody else is left alone', other.tug.name === 'somebody else' && other.stairs && other.stairs.staff);

  // Driven by the game's own physics, on the airfield.
  const elev = TERR.heightAt(0, 0);
  for (const id of V.STAFF_IDS) {
    const v = new SURF.SurfaceVehicle(id);
    v.reset({ pos: new THREE.Vector3(-300, 0, 0), headingDeg: 90 });
    let top = 0;
    for (let i = 0; i < 60 * 25; i++) {
      v.update(1 / 60, { throttle: 1, brake: 0, steer: 0, handbrake: false });
      top = Math.max(top, v.speed);
    }
    const want = SURF.VEHICLES[id].topSpeed;
    ok(`${id}: tops out near its own top speed`, near(top, want, want * 0.12), `${(top * 3.6).toFixed(0)} km/h vs ${(want * 3.6).toFixed(0)}`);
    ok(`${id}: sits on the ground`, near(v.pos.y, elev, 0.3), `${v.pos.y.toFixed(2)} vs ${elev.toFixed(2)}`);
  }
}

/* ---------------------------------------------------------------- */
/* Walking                                                           */
/* ---------------------------------------------------------------- */
if (W) {
  const dt = 1 / 60;
  const elev = TERR.heightAt(0, -30);
  const w = new W.Walker().place(0, -30, 0);
  for (let i = 0; i < 300; i++) w.step(dt, 0, -1, false, false, null);
  ok('walks 9 m in 5 s', near(w.walked, 9, 0.6), `${w.walked.toFixed(2)} m`);
  ok('feet stay on the runway', near(w.y, elev, 0.01));
  ok('faces the way it walks', near(w.heading, 0, 1) || near(w.heading, 360, 1), `${w.heading.toFixed(1)}`);
  w.place(0, -30, 0);
  for (let i = 0; i < 120; i++) w.step(dt, 0, -1, true, false, null);
  ok('runs at over 4.5 m/s', w.speed > 4.5, `${w.speed.toFixed(2)}`);
  w.place(0, -30, 0);
  w.step(dt, 0, 0, false, true, null);
  let peak = 0;
  for (let i = 0; i < 90; i++) {
    w.step(dt, 0, 0, false, false, null);
    peak = Math.max(peak, w.y - elev);
  }
  ok('jumps and lands again', peak > 0.4 && !w.air && near(w.y, elev, 0.01), `peak ${peak.toFixed(2)} m`);

  // A wall across the path.
  TERR.addObstacleAt(0, -60, 12, 3, elev - 0.5, 8, 'the test wall');
  W.forgetObstacles();
  w.place(0, -40, 0);
  let inside = 0;
  for (let i = 0; i < 60 * 20; i++) {
    w.step(dt, 0, -1, true, false, null);
    if (Math.abs(w.x) < 6 + W.WALK.radius - 0.02 && w.z > -61.5 - W.WALK.radius + 0.02 && w.z < -58.5 + W.WALK.radius - 0.02) inside++;
  }
  ok('cannot walk through a wall', inside === 0 && near(w.z, -58.5 + W.WALK.radius, 0.05), `ended at z ${w.z.toFixed(2)}, ${inside} frames inside`);
  ok('knows what stopped it', w.lastBlock === 'the test wall', w.lastBlock);
  // Pressed at an angle it slides along the wall, not through it.
  w.place(0, -57, 0);
  for (let i = 0; i < 180; i++) w.step(dt, 0.7, -0.7, false, false, null);
  ok('slides along a wall walked into at an angle', w.x > 2 && w.z > -58.5, `x ${w.x.toFixed(2)} z ${w.z.toFixed(2)}`);
  // A stall of a quarter of a second must not carry it through.
  TERR.addObstacleAt(40, -60, 12, 0.6, elev - 0.5, 8, 'a thin wall');
  W.forgetObstacles();
  w.place(40, -56, 0);
  for (let i = 0; i < 40; i++) w.step(0.25, 0, -1, true, false, null);
  ok('a long frame does not tunnel through a thin wall', w.z > -59.7, `z ${w.z.toFixed(2)}`);
  // A corner made of two boxes.
  TERR.addObstacleAt(80, -60, 10, 2, elev - 0.5, 8, 'corner a');
  TERR.addObstacleAt(86, -55, 2, 10, elev - 0.5, 8, 'corner b');
  W.forgetObstacles();
  w.place(80, -52, 0);
  for (let i = 0; i < 400; i++) w.step(dt, 0.7, -0.7, true, false, null);
  ok('does not squeeze through a corner', !W.solidAt(w.x, w.z, w.y, W.WALK.radius - 0.03, null), `at ${w.x.toFixed(2)}, ${w.z.toFixed(2)}`);

  // A parked thing turned at an angle.
  const s = W.solidBox({}, 0, -100, 30, 4, 1.5, elev - 1, elev + 3, 'a parked tug');
  w.place(-8, -100, 90);
  let hitSolid = 0;
  for (let i = 0; i < 400; i++) {
    w.step(dt, 1, 0, false, false, [s]);
    if (W.solidAt(w.x, w.z, w.y, W.WALK.radius - 0.03, [s])) hitSolid++;
  }
  ok('cannot walk through a parked vehicle at an angle', hitSolid === 0 && w.lastBlock === 'a parked tug', `${hitSolid} frames inside`);
  // Under a wing that is higher than your head.
  const wing = W.solidBox({}, 0, -140, 90, 2, 10, elev + 2.0, elev + 2.4, 'a high wing');
  w.place(-3, -140, 90);
  for (let i = 0; i < 200; i++) w.step(dt, 1, 0, false, false, [wing]);
  ok('walks under a wing that is above head height', w.x > 2.5, `x ${w.x.toFixed(2)}`);
  TERR.clearObstacles();
  W.forgetObstacles();

  /*
   * Props: what the airfield draws and OBSTACLES does not list. The rebuilt
   * airfield draws its parked airliners, bridges and trucks as InstancedMesh,
   * which the walker used to skip.
   */
  {
    const grp = new THREE.Group();
    const mat = new THREE.MeshBasicMaterial();
    // A 10 x 2 m box turned 45 degrees, standing on the ground at (0, -180).
    const turned = new THREE.Mesh(new THREE.BoxGeometry(10, 2, 2), mat);
    turned.position.set(0, elev + 1, -180);
    turned.rotation.y = Math.PI / 4;
    grp.add(turned);
    // Two trucks as instances; the second one will drive off.
    const trucks = new THREE.InstancedMesh(new THREE.BoxGeometry(2, 2, 6), mat, 2);
    const m = new THREE.Matrix4();
    trucks.setMatrixAt(0, m.makeTranslation(30, elev + 1, -180));
    trucks.setMatrixAt(1, m.makeTranslation(60, elev + 1, -180));
    grp.add(trucks);
    // A parked Meridian drawn as instances, facing east.
    const partGeo = new THREE.BoxGeometry(30, 4, 30);
    const parked = new THREE.InstancedMesh(partGeo, mat, 1);
    parked.name = 'parked:meridian|test';
    parked.setMatrixAt(0, m.makeRotationY(-Math.PI / 2).setPosition(120, elev + 4, -180));
    const parked2 = new THREE.InstancedMesh(partGeo, mat, 1);
    parked2.name = 'parked:meridian|test';
    parked2.setMatrixAt(0, m);
    grp.add(parked, parked2);
    const mprof = J.planeProfile(TYPES.getAircraft('meridian'), null);
    const n = W.setProps([grp], { aircraft: (id) => (id === 'meridian' ? mprof : null) });
    ok('props: a turned mesh, two instances and one parked aeroplane (body and wing)', n === 5, `${n} props`);
    // Walk along the turned box's short axis, at its middle: stopped by it, not by its square.
    const walkInto = (x0, z0, mx, mz, secs) => {
      w.place(x0, z0, 0);
      w.lastBlock = '';
      for (let i = 0; i < 60 * secs; i++) w.step(dt, mx, mz, false, false, null);
      return w;
    };
    // Its long side faces (0.71, 0.71): walk at it square on, from four metres out.
    walkInto(-2.83, -182.83, 0.7071, 0.7071, 4);
    const off = w.x * 0.7071 + (w.z + 180) * 0.7071;
    ok('props: a mesh turned 45 degrees stops you at its face, not at its square',
      w.lastBlock === 'something in the way' && Math.abs(off + 1 + W.WALK.radius) < 0.06 && Math.abs(w.x) < 4.2,
      `stopped ${off.toFixed(2)} m from its middle line (face at -1, square's edge at x -4.24; x ${w.x.toFixed(2)}), by ${w.lastBlock}`);
    walkInto(60, -170, 0, -1, 6);
    ok('props: an instanced truck is solid', w.z > -183 + W.WALK.radius - 0.05 && /something/.test(w.lastBlock), `z ${w.z.toFixed(2)}`);
    // It drives off; its old spot is clear and its new one is not.
    trucks.setMatrixAt(1, m.makeTranslation(60, elev + 1, -220));
    trucks.instanceMatrix.needsUpdate = true;
    walkInto(60, -170, 0, -1, 10);
    ok('props: when an instance moves, its old spot is clear', w.z < -186, `z ${w.z.toFixed(2)}`);
    walkInto(60, -205, 0, -1, 6);
    ok('props: and its new spot is solid', w.z > -223 + W.WALK.radius - 0.05, `z ${w.z.toFixed(2)}`);
    // The parked aeroplane: the fuselage stops you, the wing (above your head) does not.
    walkInto(120 + mprof.wingFront - 1, -196, 0, 1, 8);
    ok('props: a parked aeroplane drawn as instances is its fuselage, not a 30 m square', w.z > -181 - mprof.halfWidth - W.WALK.radius - 0.05 && w.z < -180 - mprof.halfWidth, `z ${w.z.toFixed(2)} (fuselage side at ${(-180 - mprof.halfWidth).toFixed(2)}), by ${w.lastBlock}`);
    W.setProps([]);
  }

  // The sea: walk out from the beach and be stopped short of deep water.
  let shore = null;
  for (let k = 0; k < 16 && !shore; k++) {
    const a = (k / 16) * Math.PI * 2;
    const sx = Math.sin(a);
    const sz = -Math.cos(a);
    for (let d = 100; d < 8000; d += 20) {
      if (TERR.heightAt(sx * d, sz * d) < -3) {
        for (let e = d; e > 0; e -= 1) {
          if (TERR.heightAt(sx * e, sz * e) > 0.6) {
            shore = { x: sx * (e - 5), z: sz * (e - 5), mx: sx, mz: sz };
            break;
          }
        }
        break;
      }
    }
  }
  if (shore) {
    w.place(shore.x, shore.z, 0);
    let deepest = 99;
    for (let i = 0; i < 60 * 30; i++) {
      w.step(dt, shore.mx, shore.mz, true, false, null);
      deepest = Math.min(deepest, TERR.heightAt(w.x, w.z));
    }
    ok('cannot walk into deep water', deepest >= W.WALK.deep - 0.01, `deepest ${deepest.toFixed(2)} m; stopped by ${w.lastBlock}`);
  } else {
    ok('found a beach to test the sea on', false);
  }

  // The drawn terrain: exactly the vertex heights at the vertices.
  const scene = new THREE.Scene();
  const group = TERR.createTerrain(scene, 'low');
  const n = W.setTerrainMeshes(group);
  ok('reads the terrain chunks', n === group.children.length, `${n} of ${group.children.length}`);
  const m0 = group.children[0];
  const arr = m0.geometry.attributes.position.array;
  const Wd = Math.round(Math.sqrt(m0.geometry.attributes.position.count));
  let worst = 0;
  for (const i of [Wd * 40 + 70, Wd * 90 + 33, Wd * 120 + 120]) {
    const x = arr[i * 3] + m0.position.x;
    const z = arr[i * 3 + 2] + m0.position.z;
    const d = W.drawnHeight(x + 0.001, z + 0.001);
    worst = Math.max(worst, Math.abs(d - arr[i * 3 + 1]));
  }
  ok('the drawn height at a vertex is that vertex', worst < 0.05, `${worst.toFixed(3)} m`);
  W.setTerrainMeshes(null);
}

/* ---------------------------------------------------------------- */
/* The jobs' arithmetic                                              */
/* ---------------------------------------------------------------- */
if (J) {
  const type = TYPES.getAircraft('meridian');
  const model = MA.createAircraftModel({ type });
  const prof = J.planeProfile(type, model);
  // The civil team redrew the Meridian (slimmer body, so longer before its
  // belly meets the tail-strike line): 1.78 -> 1.29 m half-width, 7.06 -> 7.71 m
  // nose. The point of the check is that the jobs measure the DRAWN aeroplane.
  ok('the Meridian measured off its model', near(prof.halfWidth, 1.29, 0.1) && near(prof.nose, 7.71, 0.2) && prof.halfSpan > 13, JSON.stringify({ hw: prof.halfWidth.toFixed(2), nose: prof.nose.toFixed(2), span: prof.halfSpan.toFixed(1) }));
  ok('its front door is a stair truck’s height up', prof.sill > 1.5 && prof.sill < 3.5, `${prof.sill.toFixed(2)} m`);
  ok('its front door is ahead of its wing', prof.doorFront > prof.wingFront, `${prof.doorFront.toFixed(1)} vs ${prof.wingFront.toFixed(1)}`);
  // Every aeroplane you can climb out of measures as an aeroplane: the
  // flying wing measured 0.6 m long before, off its biggest thin part.
  const odd = [];
  for (const t of TYPES.AIRCRAFT) {
    try {
      const p = J.planeProfile(t, MA.createAircraftModel({ type: t }));
      if (!(p.len > 4 && p.nose > 0 && p.tail < 0 && p.halfWidth >= 0.35 && p.halfWidth < 4 && p.halfSpan > p.halfWidth)) {
        odd.push(`${t.id} len ${p.len.toFixed(1)} nose ${p.nose.toFixed(1)} tail ${p.tail.toFixed(1)} hw ${p.halfWidth.toFixed(2)}`);
      }
    } catch (e) {
      odd.push(`${t.id} threw ${e.message}`);
    }
  }
  ok(`all ${TYPES.AIRCRAFT.length} aeroplanes measure sensibly for getting out of`, odd.length === 0, odd.join('; '));
  // The helicopter's widest part is its rotor; its wing is a stub.
  const heli = TYPES.getAircraft('harrier');
  if (heli) {
    const hp = J.planeProfile(heli, MA.createAircraftModel({ type: heli }));
    ok('the Skyhook’s wing box is its stub wing, not its rotor', hp.wingSpan < 3.2 && hp.halfSpan > 4.5,
      `wing ${hp.wingSpan.toFixed(2)} m out, rotor ${hp.halfSpan.toFixed(2)} m`);
    ok('an aeroplane’s wing box is its whole wing', near(prof.wingSpan, prof.halfSpan, 0.3), `${prof.wingSpan.toFixed(2)} of ${prof.halfSpan.toFixed(2)}`);
  }

  // Pushback.
  const plane = { x: 0, z: 0, heading: 0 };
  const hitch = 5.2;
  const ng = J.noseGearPoint(plane, prof);
  let tug = { heading: 180 };
  let tp = J.offset(ng.x, ng.z, 180, -hitch, 0);
  tug.x = tp.x;
  tug.z = tp.z;
  ok('a tug nose to nose is hookable', J.hookable(tug, plane, prof, hitch).ok);
  ok('a tug side-on is not', !J.hookable({ ...tug, heading: 120 }, plane, prof, hitch).ok);
  ok('a tug ten metres off is not', !J.hookable({ ...tug, z: tug.z - 10 }, plane, prof, hitch).ok);
  // One frame of the tug, as staff.js drives it: the tug moves, the
  // aeroplane rolls as far as the bar pushed it, and the tug goes back on the
  // nose leg.
  const tugStep = (d) => {
    tp = J.offset(tug.x, tug.z, tug.heading, d, 0);
    const tip = J.hitchPoint(tp.x, tp.z, tug.heading, hitch);
    J.towStep(plane, prof, tip.x, tip.z, tug.heading, prof.wheelbase * 1.6, tip);
    const at = J.tugAtTip(tip.x, tip.z, tug.heading, hitch);
    tug.x = at.x;
    tug.z = at.z;
  };
  // Push straight back 20 m.
  for (let i = 0; i < 200; i++) tugStep(0.1);
  ok('pushed straight, it goes straight back', near(plane.z, 20, 0.05) && near(plane.x, 0, 0.01) && near(plane.heading, 0, 0.01), `${plane.x.toFixed(2)}, ${plane.z.toFixed(2)}, ${plane.heading.toFixed(2)}`);
  // Steer right (tug heading up) and the tail goes to the tug's right.
  for (let i = 0; i < 150; i++) {
    tug.heading = Math.min(tug.heading + 0.3, 225);
    tugStep(0.1);
  }
  /*
   * And it rolls on its wheels, never sideways: every metre it moved went
   * along its own length. The first towStep put the nose leg wherever the
   * bar tip went, and a quarter-turn push slid the aeroplane twenty metres
   * sideways onto the next stand.
   */
  {
    const p = { x: 0, z: 0, heading: 0 };
    const t0 = J.noseGearPoint(p, prof);
    let th = 180;
    const tip = { x: t0.x, z: t0.z };
    let slide = 0;
    for (let i = 0; i < 400; i++) {
      th = J.tugHeadingFor(p.heading, 50);
      const px = p.x;
      const pz = p.z;
      const h0 = p.heading;
      tip.x += Math.sin(th * Math.PI / 180) * 0.1;
      tip.z -= Math.cos(th * Math.PI / 180) * 0.1;
      J.towStep(p, prof, tip.x, tip.z, th, prof.wheelbase * 1.6, tip);
      const side = J.local(px, pz, (h0 + p.heading) / 2, p.x, p.z).side;
      slide = Math.max(slide, Math.abs(side));
    }
    ok('a pushed aeroplane rolls along its length, never sideways', slide < 0.002, `${(slide * 1000).toFixed(2)} mm sideways in a 10 cm step`);
  }
  /*
   * The tug faces south, so its right is west (-x). Steering right, the
   * aeroplane lines up behind the tug's new heading like one long vehicle:
   * its tail ends up west of where a straight push leaves it, and it turns
   * clockwise. (A real towbar does the opposite — it is reversing a trailer —
   * which is exactly why this is not modelled as one.)
   */
  const tail = J.offset(plane.x, plane.z, plane.heading, prof.tail, 0);
  ok('steer the tug right and the tail swings to the right as the driver sees it', tail.x < -2 && plane.heading > 10 && plane.heading < 60, `tail at x ${tail.x.toFixed(1)}; heading ${plane.heading.toFixed(1)}`);
  const tipNow = J.hitchPoint(tug.x, tug.z, tug.heading, hitch);
  const ngNow = J.noseGearPoint(plane, prof);
  ok('the nose leg stays on the towbar', Math.hypot(tipNow.x - ngNow.x, tipNow.z - ngNow.z) < 1e-6);
  ok('the towbar angle is measured the right way round', near(J.towAngle(200, 20), 0, 1e-9) && near(J.towAngle(230, 20), 30, 1e-9));
  ok('and the tug heading for a bar angle is its inverse', near(J.towAngle(J.tugHeadingFor(37, 25), 37), 25, 1e-9));
  const box = J.pushBoxFor({ x: 0, z: 0, heading: 0 }, prof, 1);
  ok('the push box is behind the stand, turned a quarter', box.z > prof.nose && near(box.heading, 90, 1e-9), JSON.stringify(box));

  // Docking at a door.
  const parked = { x: 100, z: 50, heading: 30 };
  const door = J.doorPose(parked, prof, 'front');
  const reach = 4.05;
  const pl = J.dockedPlace(reach, door);
  ok('a truck placed at the door is docked', J.docked({ ...pl }, reach, door));
  ok('square on means facing the fuselage', near(door.heading, 120, 1e-9));
  const off = J.offset(pl.x, pl.z, pl.heading, -3, 0);
  ok('three metres short is not', !J.docked({ x: off.x, z: off.z, heading: pl.heading }, reach, door));
  ok('at 45 degrees is not', !J.docked({ ...pl, heading: pl.heading + 45 }, reach, door));
  ok('a stair truck at the door is outside the fuselage', !J.inFootprint(parked, prof, pl.x, pl.z, 0, 3.2));
  const under = J.offset(parked.x, parked.z, parked.heading, (prof.wingFront + prof.wingBack) / 2, prof.halfSpan * 0.6);
  ok('under the wing: a truck hits it, a person does not', J.inFootprint(parked, prof, under.x, under.z, 0, 3.2) && !J.inFootprint(parked, prof, under.x, under.z, 0, 1.75), `wing ${prof.wingH.toFixed(2)} m up`);

  // Marshalling.
  const stand = { x: 0, z: 0, heading: 0 };
  const a1 = new J.Arrival(stand, prof).begin(60, 0, 0);
  let res = null;
  for (let i = 0; i < 60 * 120 && !res; i++) {
    const e = a1.errors();
    res = a1.step(1 / 60, e.along > -0.5 ? 'stop' : 'come');
  }
  ok('waved in and stopped on the line, it parks', res === 'parked' && a1.result.stars >= 2, JSON.stringify(a1.result));
  const a2 = new J.Arrival(stand, prof).begin(60, 0, 0);
  res = null;
  for (let i = 0; i < 60 * 120 && !res; i++) res = a2.step(1 / 60, 'come');
  ok('never told to stop, it overshoots and the pilot stops it', res === 'overshot' && a2.result.stars === 0);
  const a3 = new J.Arrival(stand, prof).begin(60, 0, 0);
  for (let i = 0; i < 60 * 8; i++) a3.step(1 / 60, 'left');
  ok('the marshaller’s left takes it to the stand’s right', a3.errors().side > 0.3, `side ${a3.errors().side.toFixed(2)}`);
  const a4 = new J.Arrival(stand, prof).begin(60, 0, 0);
  for (let i = 0; i < 60 * 5; i++) a4.step(1 / 60, null);
  ok('with no signal the pilot waits', a4.speed === 0 && a4.errors().along < -59);
  // Tap STOP once near the line and let go: it still counts as stopped by the
  // wands. It used to sit on the line for ever, never "parked".
  const a5 = new J.Arrival(stand, prof).begin(40, 0, 0);
  res = null;
  let tapped = 0;
  for (let i = 0; i < 60 * 90 && !res; i++) {
    const e = a5.errors();
    let sig = 'come';
    if (e.along > -1.2) sig = tapped++ < 3 ? 'stop' : null;
    res = a5.step(1 / 60, sig);
  }
  ok('tap STOP and let go, and it still parks', res === 'parked', `${res}; ${JSON.stringify(a5.result)}`);
  const a6 = new J.Arrival(stand, prof).begin(45, 0, 0);
  let t6 = 0;
  for (let i = 0; i < 60 * 60 && a6.errors().along < -2; i++) {
    a6.step(1 / 60, 'come');
    t6 += 1 / 60;
  }
  ok('waved in from 45 m it arrives in under twenty seconds', t6 < 20, `${t6.toFixed(1)} s`);
}

/* ---------------------------------------------------------------- */
/* The on-foot plug-in against a stand-in game                       */
/* ---------------------------------------------------------------- */
if (OF) {
  const ext = EXT.extensions().find((e) => e.id === 'onfoot');
  const type = TYPES.getAircraft('skylark');
  const ac = {
    pos: new THREE.Vector3(0, TERR.heightAt(0, -40) + 1.5, -40),
    heading: 90,
    onGround: true,
    groundSpeed: 0,
    crashed: false,
    engineOn: true,
    starting: 0,
    stopEngine() { this.engineOn = false; },
    startEngine() { this.engineOn = true; },
  };
  const sim = {
    state: 'flying',
    mode: 'free',
    aircraft: ac,
    aircraftType: type,
    model: MA.createAircraftModel({ type }),
    scene: new THREE.Scene(),
    camera: new THREE.PerspectiveCamera(68, 1.5, 0.4, 60000),
    input: { keys: new Set(['KeyW']), throttleTarget: 0.4, out: { throttle: 0.4 }, mouse: { x: 0, y: 0 } },
    hud: { notify() {}, setCoach() {} },
    override: null,
  };
  ext.update(sim, 1 / 60);
  ok('stopped on the ground, O is on offer', OF.cannotGetOut(sim) === null);
  ac.groundSpeed = 5;
  ok('rolling, it is not', !!OF.cannotGetOut(sim));
  ac.groundSpeed = 0;
  ac.onGround = false;
  ok('in the air, it is not', /air/.test(OF.cannotGetOut(sim) || ''));
  ac.onGround = true;
  const took = ext.key(sim, 'KeyO', true, {});
  ok('O is taken by the plug-in', took === true);
  ok('and you are out', OF.onFoot.active);
  ok('the aeroplane is parked through sim.override', sim.override && sim.override.brakes === 1 && sim.override.throttle === 0 && !ac.engineOn);
  ok('the flight keys held when you climbed out are let go', sim.input.keys.size === 0);
  ok('W is taken while walking', ext.key(sim, 'KeyW', true, {}) === true);
  ok('Esc is left for the game', ext.key(sim, 'Escape', true, {}) === false);
  ok('the map key is left for the game', ext.key(sim, 'KeyJ', true, {}) === false);
  sim.input.bindings = { pause: ['KeyP'] };
  ok('pause moved to P in Settings is still pause while walking', ext.key(sim, 'KeyP', true, {}) === false);
  sim.input.bindings = null;
  ok('without that, P is the walker’s', ext.key(sim, 'KeyP', true, {}) === true);
  ext.key(sim, 'KeyP', false, {});
  const start = OF.onFoot.snapshot();
  OF.onFoot.setCamera(0, -12);
  for (let i = 0; i < 240; i++) {
    const own = ext.camera(sim, 1 / 60, sim.camera);
    if (!own) break;
    ext.update(sim, 1 / 60);
  }
  ok('the camera hook owns the camera while walking', ext.camera(sim, 1 / 60, sim.camera) === true);
  const s1 = OF.onFoot.snapshot();
  ok('walks', Math.hypot(s1.x - start.x, s1.z - start.z) > 5, `${Math.hypot(s1.x - start.x, s1.z - start.z).toFixed(1)} m`);
  ok('the key-up goes through to the game', ext.key(sim, 'KeyW', false, {}) === false);
  ok('the camera is behind the walker', sim.camera.position.distanceTo(new THREE.Vector3(s1.x, s1.y + 1.5, s1.z)) < 6);
  // An aeroplane from the traffic feature, parked across the way: solid.
  {
    const w0 = OF.onFoot.snapshot();
    sim.traffic = [{ id: 't1', typeId: 'meridian', pos: new THREE.Vector3(w0.x, 0, w0.z - 15), heading: 90, speed: 0, alt: 0, onGround: true, phase: 'parked' }];
    OF.onFoot.setCamera(0, -12);
    ext.key(sim, 'KeyW', true, {});
    for (let i = 0; i < 60 * 8; i++) ext.update(sim, 1 / 60);
    ext.key(sim, 'KeyW', false, {});
    ext.update(sim, 1 / 60);
    const s2 = OF.onFoot.snapshot();
    ok('an aeroplane from sim.traffic across the way is solid', w0.z - s2.z < 14 && w0.z - s2.z > 8, `walked ${(w0.z - s2.z).toFixed(1)} of 15 m; stopped by ${s2.lastBlock}`);
    sim.traffic = null;
    OF.onFoot.place(s1.x, s1.z);
  }
  ok('far from the aeroplane, O does not get you in', (OF.onFoot.pressO(sim), OF.onFoot.active));
  OF.onFoot.place(start.x, start.z);
  ext.update(sim, 1 / 60);
  ok('by the door it offers the way in', /get in the aeroplane/.test(OF.onFoot.snapshot().prompt), OF.onFoot.snapshot().prompt);
  ext.key(sim, 'KeyO', true, {});
  ok('O by the door gets you back in', !OF.onFoot.active);
  ok('the controls are handed back', sim.override === null && sim.input.throttleTarget === 0);
  ok('the engine is restarted', ac.engineOn);
  ok('the camera is let go', ext.camera(sim, 1 / 60, sim.camera) === false);

  /*
   * Switched off by the game while walking. Last, because it is for good:
   * a frame whose camera throws goes through the real fence in extensions.js,
   * which switches the feature off — and then nothing calls its update() or
   * key() again, so the watchdog has to hand the aeroplane back.
   */
  sim.override = null;
  ac.engineOn = true;
  ext.key(sim, 'KeyO', true, {});
  const outAgain = OF.onFoot.active && sim.override && sim.override.brakes === 1;
  const broken = new Proxy(sim, {
    get(t, k) {
      if (k === 'camera') throw new Error('test: a frame that throws');
      return t[k];
    },
  });
  const errLog = console.error;
  console.error = () => {};
  EXT.extUpdate(broken, 1 / 60);
  console.error = errLog;
  const off = EXT.extStatus().find((e) => e.id === 'onfoot');
  ok('a frame that throws switches walking off (the fence)', outAgain && off && !off.live, JSON.stringify(off));
  const retired = OF.onFoot.checkSwitchedOff();
  ok('switched off mid-walk, the watchdog gives the aeroplane back', retired && !OF.onFoot.active && sim.override === null && ac.engineOn,
    `retired ${retired}, active ${OF.onFoot.active}, override ${JSON.stringify(sim.override)}, engine ${ac.engineOn}`);
  ok('and nobody is put down on foot again', OF.onFoot.start(sim, { x: 0, z: -40 }) === false && !OF.onFoot.active);
  ok('and O no longer gets you out', !!OF.cannotGetOut(sim));
}

/* ---------------------------------------------------------------- */
const failed = results.filter((r) => !r.pass);
for (const r of results) console.log(`${r.pass ? 'ok  ' : 'FAIL'} ${r.name}${r.detail && !r.pass ? ` — ${r.detail}` : r.detail ? `  (${r.detail})` : ''}`);
console.log(`\n${results.length - failed.length} of ${results.length} passed`);
process.exit(failed.length ? 1 : 0);

/**
 * The Blender vehicles, checked in plain node:
 *
 *   node tests/features/models.mjs
 *
 * No browser and no GPU: the .glb files are read off disk through the same
 * glb.js the game uses, and every fit number is compared with what the GAME
 * CODE says — types.js for the helicopter's gear, rotor and eye, surface.js
 * for the van's wheelbase, track and ride height — not with a number copied
 * out of the modeller's report. If someone changes the flight model's gear or
 * the van's ride height, this is what notices the model no longer fits.
 *
 * Also drives each model through animateBlenderVehicle for a few seconds and
 * checks the parts move the right way round (a van wheel rolling backwards
 * looks fine on a plain cylinder and wrong on one with spokes).
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const THREE = await import('../../src/vendor/three.module.js');
const { parseGLB, drawStats } = await import('../../src/vehicles/glb.js');
const BM = await import('../../src/vehicles/blender-models.js');
const { getAircraft, specFor } = await import('../../src/aircraft/types.js');
const { VEHICLES, SurfaceVehicle } = await import('../../src/vehicles/surface.js');

let passed = 0;
const failed = [];
function ok(name, pass, detail = '') {
  if (pass) passed++;
  else failed.push(name);
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
}
const f3 = (n) => (Number.isFinite(n) ? n.toFixed(3) : String(n));
const v3 = (v) => `(${f3(v.x)}, ${f3(v.y)}, ${f3(v.z)})`;

/* ------------------------------------------------------------ the files -- */

const files = {};
for (const [kind, def] of Object.entries(BM.BLENDER_VEHICLES)) {
  const path = here(`../../assets/models/${def.file}`);
  let parsed = null;
  try {
    const t0 = performance.now();
    parsed = parseGLB(readFileSync(path), { name: def.file });
    ok(`${def.file} parses`, true, `${(performance.now() - t0).toFixed(1)} ms`);
  } catch (e) {
    ok(`${def.file} parses`, false, e.message);
    continue;
  }
  files[kind] = parsed;
  const root = parsed.scene.getObjectByName(def.root);
  ok(`${def.file} has its root ${def.root}`, !!root);
  const missing = def.parts.filter((p) => !parsed.scene.getObjectByName(p));
  ok(`${def.file} has every named part`, missing.length === 0, missing.length ? `missing ${missing.join(', ')}` : `${def.parts.length} parts`);
  const { triangles, drawCalls } = drawStats(parsed.scene);
  ok(`${def.file} is inside its triangle budget`, triangles <= def.maxTriangles && triangles === parsed.stats.triangles,
    `${triangles} of ${def.maxTriangles}, ${drawCalls} draw calls`);

  // Every number finite, every index in range, every normal a unit vector.
  let bad = 0;
  let badNormals = 0;
  let badIndex = 0;
  parsed.scene.traverse((o) => {
    if (!o.isMesh) return;
    const g = o.geometry;
    const pos = g.attributes.position.array;
    for (let i = 0; i < pos.length; i++) if (!Number.isFinite(pos[i])) bad++;
    const n = g.attributes.normal;
    if (!n) badNormals++;
    else {
      for (let i = 0; i < n.count; i++) {
        const l = Math.hypot(n.getX(i), n.getY(i), n.getZ(i));
        if (!(Math.abs(l - 1) < 0.02)) badNormals++;
      }
    }
    if (g.index) {
      const count = g.attributes.position.count;
      for (const k of g.index.array) if (k >= count) badIndex++;
    }
  });
  ok(`${def.file}: no NaN or infinite positions`, bad === 0, `${bad} bad`);
  ok(`${def.file}: every vertex has a unit normal`, badNormals === 0, `${badNormals} bad`);
  ok(`${def.file}: every index points at a vertex`, badIndex === 0, `${badIndex} bad`);
  const mats = new Set();
  parsed.scene.traverse((o) => o.isMesh && mats.add(o.material));
  ok(`${def.file}: at most 14 materials, none textured`, mats.size <= 14 && [...mats].every((m) => !m.map), `${mats.size}`);
}

/* ---------------------------------------------------------- ray probes -- */

const ray = new THREE.Raycaster();
function meshesOf(root, filter = () => true) {
  const out = [];
  root.updateMatrixWorld(true);
  root.traverse((o) => o.isMesh && filter(o) && out.push(o));
  return out;
}
/** First hit from `from` along `dir`, or null. */
function hit(meshes, from, dir, far = 50) {
  ray.set(from, dir.clone().normalize());
  ray.far = far;
  const h = ray.intersectObjects(meshes, false);
  return h.length ? h[0] : null;
}
const UP = new THREE.Vector3(0, 1, 0);

/* ---------------------------------------------------------- helicopter -- */

if (files.heli) {
  const type = getAircraft('harrier');
  const spec = specFor('harrier');
  const S = type.shape;
  const heli = files.heli.scene.getObjectByName('skyhook');
  const solid = meshesOf(heli, (o) => !o.material.transparent && !/rotor/.test(o.parent.name));

  // The skids stand on the flight model's gear points (types.js pointsFor).
  for (const g of spec.gearPoints) {
    // The nose "wheel" is a point on the skid rocker; the skids are at the mains' x.
    const x = g.name === 'nose' ? spec.gearPoints.find((p) => p.name === 'right').pos.x : g.pos.x;
    for (const sx of g.name === 'nose' ? [-1, 1] : [1]) {
      const from = new THREE.Vector3(sx * x, g.pos.y - 3, g.pos.z);
      const h = hit(solid, from, UP, 6);
      const y = h ? h.point.y : NaN;
      ok(`heli skid meets the ${g.name} gear point${g.name === 'nose' ? (sx < 0 ? ' (left)' : ' (right)') : ''}`,
        Math.abs(y - g.pos.y) < 0.02, `skid bottom ${f3(y)}, gear ${f3(g.pos.y)} at z ${f3(g.pos.z)}`);
    }
  }
  let low = Infinity;
  heli.traverse((o) => {
    if (!o.isMesh) return;
    const b = new THREE.Box3().setFromObject(o);
    low = Math.min(low, b.min.y);
  });
  const gearLow = Math.min(...spec.gearPoints.map((g) => g.pos.y));
  ok('nothing on the helicopter hangs below its skids', low >= gearLow - 0.01, `lowest ${f3(low)}, gear ${f3(gearLow)}`);

  /*
   * The rotor hub where the model was built to have it, the disc its size.
   *
   * This used to compare the hub with power.y x scale from types.js, on the
   * belief that the flight model puts the rotor thrust there. It does not:
   * nothing in physics.js or rotor-assist.js reads power.y, only the drawings
   * (model.js's fallback mast, tempest.js). The civil team then moved the
   * Skyhook's power.y from 1.6 to 1.28 so their FALLBACK drawing's mast fits
   * its cabin — correct for that drawing, and it broke this check without
   * anything flying differently. The Blender model's hub is 2.000 m up (its
   * build: 1.6 x 1.25) and stays there; z still follows power.z x scale.
   */
  const hub = heli.getObjectByName('rotor_main').getWorldPosition(new THREE.Vector3());
  const want = new THREE.Vector3(0, 2.0, (S.power.z || 0) * S.scale);
  ok('rotor hub is where the Blender build put it (2.0 m up, power.z x scale aft)', hub.distanceTo(want) < 0.01, `hub ${v3(hub)}, want ${v3(want)}`);
  const blur = new THREE.Box3().setFromObject(heli.getObjectByName('rotor_main_blur'));
  const discR = (blur.max.x - blur.min.x) / 2;
  ok('rotor disc radius is SPEC.rotorRadius', Math.abs(discR - spec.rotorRadius) < 0.02, `${f3(discR)} vs ${spec.rotorRadius}`);
  let tip = 0;
  const rotorMain = heli.getObjectByName('rotor_main');
  rotorMain.traverse((o) => {
    if (!o.isMesh) return;
    const p = o.geometry.attributes.position;
    for (let i = 0; i < p.count; i++) tip = Math.max(tip, Math.hypot(p.getX(i), p.getZ(i)));
  });
  ok('blade tips reach the disc and no further', Math.abs(tip - spec.rotorRadius) < 0.02, `tip ${f3(tip)}`);

  // The pilot's eye (types.js shape.eye x scale) is in the cabin, behind glass.
  const eye = new THREE.Vector3(...S.eye).multiplyScalar(S.scale);
  const all = meshesOf(heli, (o) => !/rotor/.test(o.parent.name));
  const looks = { forward: [0, 0, -1], left: [-1, 0, 0], right: [1, 0, 0], up: [0, 1, 0] };
  for (const [name, d] of Object.entries(looks)) {
    const h = hit(all, eye, new THREE.Vector3(...d), 5);
    const glass = h && h.object.material.name === 'glass';
    ok(`from the pilot's seat, ${name} is glass`, glass && h.distance > 0.3,
      h ? `${h.object.material.name} at ${f3(h.distance)} m` : 'nothing within 5 m');
  }
  const seat = hit(all, eye, new THREE.Vector3(0, -1, 0), 3);
  ok('the pilot sits above a seat, not inside one', seat && seat.distance > 0.3, seat ? `${f3(seat.distance)} m down` : 'nothing below');

  // The tail-strike point (types.js hardPoints) is at the bottom of the tail.
  const tail = spec.hardPoints.find((h) => h.part === 'tail');
  const tailHit = hit(solid, new THREE.Vector3(0, tail.pos.y - 3, tail.pos.z), UP, 6);
  ok('the tail-strike point is at the ventral bumper', tailHit && Math.abs(tailHit.point.y - tail.pos.y) < 0.12,
    tailHit ? `bumper ${f3(tailHit.point.y)}, strike ${f3(tail.pos.y)}` : 'no bumper under it');
}

/* ----------------------------------------------------------------- van -- */

if (files.car) {
  const car = VEHICLES.car;
  const van = files.car.scene.getObjectByName('courier_van');
  van.updateMatrixWorld(true);
  const hx = car.track / 2;
  const hz = car.wheelbase / 2;
  const road = -car.rideHeight;
  for (const [name, sx, sz] of [['wheel_fl', -1, -1], ['wheel_fr', 1, -1], ['wheel_rl', -1, 1], ['wheel_rr', 1, 1]]) {
    const w = van.getObjectByName(name);
    const p = w.position;
    const box = new THREE.Box3();
    w.traverse((o) => o.isMesh && /rubber/.test(o.material.name) && box.union(new THREE.Box3().setFromObject(o)));
    const centre = box.getCenter(new THREE.Vector3());
    ok(`${name} centre at track/2, wheelbase/2`, Math.abs(p.x - sx * hx) < 0.02 && Math.abs(p.z - sz * hz) < 0.02,
      `${v3(p)} vs (${f3(sx * hx)}, -, ${f3(sz * hz)})`);
    ok(`${name} spins about its own centre`, centre.distanceTo(p) < 0.005, `tyre centre ${v3(centre)}`);
    ok(`${name} tyre stands on the road (rideHeight ${car.rideHeight} below the origin)`, Math.abs(box.min.y - road) < 0.01,
      `tyre bottom ${f3(box.min.y)}, road ${f3(road)}`);
  }
}

/* ---------------------------------------------------------------- boat -- */

if (files.boat) {
  const boat = files.boat.scene.getObjectByName('kestrel_launch');
  boat.updateMatrixWorld(true);
  const ex = boat.userData.extras || {};
  ok('launch origin is on the design waterline', ex.design_waterline_z === 0, `design_waterline_z ${ex.design_waterline_z}`);
  const hull = boat.getObjectByName('hull');
  const b = new THREE.Box3().setFromObject(hull);
  ok('launch hull goes through the sea at y = 0', b.min.y < -0.3 && b.max.y > 0.8, `hull y ${f3(b.min.y)} to ${f3(b.max.y)}`);
  const anti = new THREE.Box3();
  hull.traverse((o) => o.isMesh && o.material.name === 'antifouling' && anti.union(new THREE.Box3().setFromObject(o)));
  ok('her antifouling stops at the waterline', Math.abs(anti.max.y) < 0.05, `boot top at ${f3(anti.max.y)}`);
  const fit = ex.fit || {};
  const dry = fit.keep_dry_points || [];
  let lowDry = Infinity;
  for (let i = 1; i < dry.length; i += 3) lowDry = Math.min(lowDry, dry[i]);
  ok('at rest every cockpit sole corner is 0.10 m above the sea', lowDry >= (fit.keep_dry_y ?? 0.1) - 1e-6, `lowest ${f3(lowDry)}`);
  ok('launch fit recipe carries hull sections for the wake', Array.isArray(fit.hull_sections) && fit.hull_sections.length === 19 * 9 * 3,
    `${(fit.hull_sections || []).length} numbers`);
  ok('launch top speed matches surface.js', fit.top_speed_mps === VEHICLES.boat.topSpeed, `${fit.top_speed_mps} vs ${VEHICLES.boat.topSpeed}`);
}

/* ---------------------------------------------------------- the loader -- */

const load = async (url) => readFileSync(fileURLToPath(url));
// The failures below are on purpose; keep their warnings out of the report.
const warned = [];
const realWarn = console.warn;
console.warn = (...a) => warned.push(a.map(String).join(' '));
// A file that will not load must leave that vehicle on its old model, and the
// promise must still resolve.
const broken = await BM.preloadVehicleModels({
  reload: true,
  load: async (url, kind) => {
    if (kind === 'car') throw new Error('simulated 404');
    return load(url);
  },
});
ok('a missing file does not reject the preload', broken.car === 'failed' && broken.heli === 'ready' && broken.boat === 'ready',
  JSON.stringify({ heli: broken.heli, car: broken.car, boat: broken.boat }));
ok('a vehicle that failed to load gives null (the caller keeps its fallback)', BM.blenderCar() === null);
const junk = await BM.preloadVehicleModels({ reload: true, only: ['boat'], load: async () => new Uint8Array([1, 2, 3, 4]) });
ok('a corrupt file is caught the same way', junk.boat === 'failed' && /GLB/.test(junk.errors.boat || ''), junk.errors.boat);
console.warn = realWarn;
ok('...and each failure says so on the console', warned.length === 2 && warned.every((w) => /keeping the built-in one/.test(w)), `${warned.length} warnings`);
const good = await BM.preloadVehicleModels({ reload: true, load });
ok('all three load', good.heli === 'ready' && good.car === 'ready' && good.boat === 'ready', JSON.stringify(good.ms));

/* ------------------------------------------------------------ animation -- */

const step = (m, state, seconds, dt = 1 / 60) => {
  for (let t = 0; t < seconds; t += dt) BM.animateBlenderVehicle(m, state, dt);
  m.updateMatrixWorld(true);
};
const finite = (m) => {
  let fine = true;
  m.traverse((o) => o.matrixWorld.elements.forEach((e) => (fine &&= Number.isFinite(e))));
  return fine;
};

// Van: rolls forward the right way round, steers right for +steer, wheels
// stay on the road while the body leans, lamps answer.
{
  const a = BM.blenderCar();
  const b = BM.blenderCar();
  ok('two vans share geometry', a.getObjectByName('body').children[0].geometry === b.getObjectByName('body').children[0].geometry);
  const P = a.userData.parts;
  const top = () => P.wheel_fl.localToWorld(new THREE.Vector3(0, 0.3, 0));
  a.updateMatrixWorld(true);
  const before = top();
  step(a, { speed: 1, steer: 0 }, 0.1);
  ok('van wheels roll forward (the top of the tyre moves to -Z)', top().z < before.z, `${f3(before.z)} -> ${f3(top().z)}`);
  step(a, { speed: 0, steerAngle: 0.5 }, 0.05);
  const nose = P.wheel_fl.localToWorld(new THREE.Vector3(0, 0, -0.3)).sub(P.wheel_fl.getWorldPosition(new THREE.Vector3()));
  ok('+steer turns the front wheels right', nose.x > 0.05, `wheel nose points x ${f3(nose.x)}`);
  const rear = P.wheel_rl.localToWorld(new THREE.Vector3(0, 0, -0.3)).sub(P.wheel_rl.getWorldPosition(new THREE.Vector3()));
  ok('the rear wheels do not steer', Math.abs(rear.x) < 1e-6);
  // Lean the body the way main.js would (the model's own quaternion) and check the tyres.
  const lean = 0.16;
  a.quaternion.setFromEuler(new THREE.Euler(0.04, 0, lean, 'YXZ'));
  step(a, { speed: 0, bodyPitch: 0.04, bodyRoll: lean }, 0.05);
  let worst = 0;
  for (const n of ['wheel_fl', 'wheel_fr', 'wheel_rl', 'wheel_rr']) {
    // Precise: a spun wheel's axis-aligned box is bigger than the wheel.
    const box = new THREE.Box3().setFromObject(P[n], true);
    worst = Math.max(worst, Math.abs(box.min.y - -VEHICLES.car.rideHeight));
  }
  ok('with the body leaning 0.16 rad the tyres stay on the road', worst < 0.02, `worst tyre ${f3(worst)} m off`);
  a.quaternion.identity();
  const L = a.userData.lamps;
  step(a, { braking: true, reverse: true }, 0.05);
  const brakeOn = L.light_brake.light_red.emissiveIntensity;
  const revOn = L.light_reverse.light_reverse.emissiveIntensity;
  step(a, { braking: false, reverse: false }, 0.05);
  ok('brake lamps light', brakeOn > 2 && L.light_brake.light_red.emissiveIntensity === 0, `${f3(brakeOn)} / off ${f3(L.light_brake.light_red.emissiveIntensity)}`);
  ok('the tail lamps do not light with the brakes', L.light_tail.light_red !== L.light_brake.light_red);
  ok('reverse lamp lights', revOn > 1.5, f3(revOn));
  ok('another van is not lit by this one', b.userData.lamps.light_brake.light_red.emissiveIntensity === 2);
  let seen = 0;
  for (let i = 0; i < 60; i++) {
    BM.animateBlenderVehicle(a, { steer: 0.5 }, 1 / 60);
    if (L.light_indicator_r.light_indicator.emissiveIntensity > 10) seen++;
  }
  ok('the right indicator blinks in a right turn', seen > 10 && seen < 50, `${seen} of 60 frames lit`);
  ok('van matrices stay finite', finite(a));
}

// Helicopter: rotor turns about the hub, stays on it, blur fades in.
{
  const h = BM.blenderHeli();
  const P = h.userData.parts;
  const hub0 = P.rotor_main.getWorldPosition(new THREE.Vector3());
  const tipAt = () => P.rotor_main.localToWorld(new THREE.Vector3(3, 0, 0));
  h.updateMatrixWorld(true);
  const t0 = tipAt();
  step(h, { rotor: 1, lights: true }, 0.2);
  const hub1 = P.rotor_main.getWorldPosition(new THREE.Vector3());
  ok('main rotor turns', tipAt().distanceTo(t0) > 0.5);
  ok('main rotor turns about its hub', hub1.distanceTo(hub0) < 1e-6, v3(hub1));
  ok('the blur disc shows at full speed', P.rotor_main_blur.visible && h.userData.lamps.rotor_main_blur.rotor_blur.opacity > 0.05);
  step(h, { rotor: 0 }, 0.05);
  ok('and not with the rotor stopped', !P.rotor_main_blur.visible);
  step(h, { winch: 10 }, 0.02);
  const hook = new THREE.Box3().setFromObject(P.winch_hook);
  ok('the hoist pays out: 10 m of cable puts the hook ~10 m below the arm', hook.max.y < 1.03 - 9.4, `hook top ${f3(hook.max.y)}`);
  const wrapped = BM.blenderAircraftModel(getAircraft('harrier'));
  wrapped.updateMatrixWorld(true);
  const wHub = wrapped.userData.parts.rotor_main.getWorldPosition(new THREE.Vector3());
  ok('the aeroplane wrapper is scaled like every other aeroplane (cockpit maths)', Math.abs(wrapped.scale.x - getAircraft('harrier').shape.scale) < 1e-9);
  ok('...and the helicopter inside it is still full size', wHub.distanceTo(hub0) < 1e-6, v3(wHub));
  wrapped.userData.update(1 / 60, { engineOn: true, rpm: 0.5, onGround: true, agl: 0, controls: { pitch: 0, roll: 0 } }, { isNight: true, cond: { cloud: 0 } });
  ok('engine on at spawn: the rotor starts at speed', wrapped.userData.blenderModel.userData.anim.nr === 1);
  ok('the searchlight comes on at night on the pad', wrapped.userData.blenderModel.userData.spot.intensity > 100);
  ok('the Blender helicopter is only for the Skyhook', BM.blenderAircraftModel(getAircraft('skylark')) === null);
  ok('heli matrices stay finite', finite(h) && finite(wrapped));
}

// Launch: outboards steer with +steer to starboard, props counter-rotate, she
// sits at the waterline at rest and stays dry in a full-lock turn — posed by
// the GAME (surface.js drawnRise, with the hull's own numbers), which is the
// only thing that poses her.
{
  const m = BM.blenderBoat();
  const P = m.userData.parts;
  step(m, { speed: 7, steer: 1, wake: false }, 0.1);
  const tiller = P.outboard_r.localToWorld(new THREE.Vector3(0, 0, -1)).sub(P.outboard_r.getWorldPosition(new THREE.Vector3()));
  ok('outboards swing with steer (finishBoat\'s sign)', Math.abs(P.outboard_r.rotation.y - 0.42) < 1e-6 && tiller.x < 0, `rotation ${f3(P.outboard_r.rotation.y)}`);
  ok('the props counter-rotate', Math.sign(P.prop_l.rotation.z) === -Math.sign(P.prop_r.rotation.z) && P.prop_r.rotation.z !== 0);

  // One owner of her pose: animating her leaves where she sits alone.
  m.position.set(1, 0.2, 3);
  m.quaternion.setFromEuler(new THREE.Euler(0.05, 0.3, -0.1, 'YXZ'));
  const p0 = m.position.clone();
  const q0 = m.quaternion.clone();
  step(m, { speed: 13, steer: 1, sea: 0 }, 1);
  ok('animating her does not pose her (surface.js does, once)', m.position.equals(p0) && m.quaternion.angleTo(q0) < 1e-9,
    `moved ${f3(m.position.distanceTo(p0))} m, turned ${f3(m.quaternion.angleTo(q0))} rad`);

  const fitH = m.userData.hullFit;
  const exFit = m.userData.extras.fit;
  ok('she hands the game her own hull: deck points, clearance, bottom and planing lift',
    !!fitH && fitH.deck.length === exFit.keep_dry_points.length && fitH.clear === exFit.keep_dry_y &&
      fitH.keel.length === 19 * 3 * 3 && fitH.planeLift === exFit.planing_lift_m && m.userData.waterline === 0,
    fitH ? `${fitH.deck.length / 3} deck points, ${fitH.keel.length / 3} bottom points, lift ${fitH.planeLift} m` : 'no hullFit');
  ok('her wake is where the game reads a boat\'s wake', m.userData.wake === m.userData.water.wash && m.userData.bowWave === m.userData.water.bow &&
    m.userData.wake.renderOrder > 2 && m.userData.bowWave.renderOrder > 2);

  const v = new SurfaceVehicle('boat').fitHull(fitH);
  const S = v.spec;
  /** Pose the model exactly as main.js does: at v.pos.y = rise, attitude v.pitch / v.bank. */
  const place = (rise) => {
    m.position.set(0, rise, 0);
    m.quaternion.setFromEuler(new THREE.Euler(v.pitch, 0, v.bank, 'YXZ'));
    m.updateMatrixWorld(true);
  };
  const lowDeck = () => {
    let low = Infinity;
    for (let i = 0; i < fitH.deck.length; i += 3) low = Math.min(low, new THREE.Vector3().fromArray(fitH.deck, i).applyMatrix4(m.matrixWorld).y);
    return low;
  };
  const keelY = () => new THREE.Box3().setFromObject(P.hull, true).min.y;

  // At rest on a flat calm she floats at her design waterline.
  v.speed = 0;
  v.steer = 0;
  v.pitch = 0;
  v.bank = 0;
  const rest = v.drawnRise(0);
  place(rest);
  ok('at rest her waterline is the sea (no lowering, no lift)', Math.abs(rest) < 1e-9 && v.dryLift === 0,
    `y ${f3(rest)}, keel ${f3(keelY())} m, cockpit sole ${f3(lowDeck())} m`);
  ok('...at her designed draught: keel 0.5-0.6 m down, sole corners 0.35 m up', keelY() < -0.5 && keelY() > -0.6 && Math.abs(lowDeck() - 0.35) < 0.005);

  /*
   * The sea's worst, from surface.js's own seaMotion: run it for a minute
   * and keep the extremes of the heave, the sea's pitch and its roll.
   */
  const seaFor = (sea) => {
    const w = new SurfaceVehicle('boat');
    w.sea = sea;
    const x = { hMin: Infinity, hMax: -Infinity, p: 0, r: 0 };
    for (let t = 0; t < 60; t += 1 / 60) {
      w.t = t;
      w.seaMotion(1 / 60);
      x.hMin = Math.min(x.hMin, w.heave);
      x.hMax = Math.max(x.hMax, w.heave);
      x.p = Math.max(x.p, Math.abs(w.seaPitch));
      x.r = Math.max(x.r, Math.abs(w.seaRoll));
    }
    return x;
  };
  /** Every speed and helm, at the bottom and the top of the heave with the sea's pitch and roll either way. */
  const envelope = (sea, speeds, steers) => {
    const x = seaFor(sea);
    const out = { worstLift: 0, worstAt: 0, lowestDeck: Infinity, highestKeel: -Infinity, rolls: 0 };
    for (const spd of speeds) {
      for (const steer of steers) {
        for (const heave of [x.hMin, x.hMax]) {
          for (const sp of [-1, 1]) {
            for (const sr of [-1, 1]) {
              v.speed = spd;
              v.steer = steer;
              v.pitch = Math.min(1, spd / S.topSpeed) * S.planeTrim + sp * x.p;
              v.bank = -steer * S.bankInTurn * Math.min(1, spd / 8) + sr * x.r;
              const y = v.drawnRise(heave);
              if (v.dryLift > out.worstLift) {
                out.worstLift = v.dryLift;
                out.worstAt = spd;
              }
              place(y);
              out.lowestDeck = Math.min(out.lowestDeck, lowDeck());
              out.highestKeel = Math.max(out.highestKeel, keelY());
              out.rolls = Math.max(out.rolls, Math.abs(v.bank));
            }
          }
        }
      }
    }
    return out;
  };
  const speeds = [];
  for (let s = 3.5; s <= 14; s += 0.25) speeds.push(s);

  /*
   * A full-lock turn at every speed from 3.5 to 14 m/s in a Breezy Afternoon
   * sea (0.39). build.py's BOUND gate budgeted 0.282 m of keep-dry lift for
   * this, with its own recipe stacked on the game's; with the game's pose
   * alone she must need no more than that budget, keep the sole 0.10 m up
   * and keep her hull in the water.
   */
  const lock = envelope(0.39, speeds, [1]);
  ok('full lock at any speed in a 0.39 sea needs at most 0.30 m of keep-dry lift', lock.worstLift <= 0.3,
    `worst ${f3(lock.worstLift)} m at ${lock.worstAt} m/s`);
  ok('...keeps the cockpit sole 0.10 m above the sea', lock.lowestDeck >= fitH.clear - 1e-6, `lowest ${f3(lock.lowestDeck)}`);
  ok('...and her hull is still in the water', lock.highestKeel < 0, `highest keel ${f3(lock.highestKeel)}`);

  /*
   * And the Gale's sea (1.04, as In the Gale measures it), every speed from
   * rest, straight and at full lock either way: the cockpit never floods and
   * the hull never leaves the flat sea — not even at the top of the heave on
   * the plane, where the heave she shows and her 0.45 m of planing lift
   * together took her keel clear of the water before keelImmersion.
   */
  const gale = envelope(1.04, [0, 2, 4, 6, 8, 10, 12, 14], [-1, 0, 1]);
  ok('in a gale sea at any speed and helm the cockpit sole stays 0.10 m up', gale.lowestDeck >= fitH.clear - 1e-6,
    `lowest ${f3(gale.lowestDeck)} m, worst keep-dry lift ${f3(gale.worstLift)} m`);
  // Within 5 mm: the game keeps the hull SECTIONS in, and the mesh between them is a few mm off them.
  ok('...and her keel stays 0.15 m in the water', gale.highestKeel <= -S.keelImmersion + 0.005, `highest keel ${gale.highestKeel.toFixed(4)} m`);
  ok('...while she still rolls like a gale (more than 8 degrees either way)', gale.rolls * 57.3 > 8, `${f3(gale.rolls * 57.3)} deg`);

  m.position.set(0, 0, 0);
  m.quaternion.identity();
  step(m, { speed: 13, steer: 0.4, sea: 0 }, 3);
  ok('she makes a wake at speed', m.userData.water && m.userData.water.alive > 10 && m.userData.wake.count > 10, `${m.userData.water && m.userData.water.alive} sprites`);
  ok('...and a bow wave', m.userData.bowWave.visible && m.userData.bowWave.material.opacity > 0.2,
    `opacity ${f3(m.userData.bowWave.material.opacity)}`);
  ok('boat matrices stay finite', finite(m));
}

console.log(`\n${passed} passed, ${failed.length} failed${failed.length ? ':\n  ' + failed.join('\n  ') : ''}`);
process.exitCode = failed.length ? 1 : 0;

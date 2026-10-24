/**
 * The C-17 Globemaster III's own checks, in node: the hold and the ramp.
 *
 *   node tests/features/c17.mjs
 *
 * The roster, the flight model, the take-off and landing on Kestrel, the
 * doors and the rest of the airliner battery are tests/features/new-
 * aircraft.mjs's (`node tests/features/new-aircraft.mjs c17`); this file is
 * what the C-17 has that no other aeroplane here has — an opening cut in
 * the skin with a ramp that comes down to the ground, a cargo door that
 * swings up inside, a hold you can see into, and the rule that opens them.
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

const SRC = new URL('../../src/', import.meta.url).href;
const THREE = await import(SRC + 'vendor/three.module.js');
const T = await import(SRC + 'aircraft/types.js');
const ADAPTER = await import(SRC + 'aircraft/model-adapter.js');
const LIV = await import(SRC + 'aircraft/liveries.js');
const { C17_GEOMETRY, C17_RAMP, C17_DOORS } = await import(SRC + 'aircraft/extra/c17.js');
const { AIRLINER_GEOMETRY, AIRLINER_DOORS } = await import(SRC + 'aircraft/extra/airliners.js');
const { cutOpening } = await import(SRC + 'fleet/extra/c17.js');
const RULE = await import(SRC + 'features/cargo-ramp.js');
const INPUT = await import(SRC + 'flight/input.js');

let failed = 0;
let passed = 0;
function ok(name, pass, detail = '') {
  if (pass) passed++;
  else failed++;
  console.log(`${pass ? 'ok  ' : 'FAIL'} ${name}${detail !== '' ? ` — ${detail}` : ''}`);
}
const r2 = (v) => +v.toFixed(2);
const DEG = 180 / Math.PI;

/* ------------------------------------------------------------------ *
 * The roster and the geometry
 * ------------------------------------------------------------------ */
const type = T.getAircraft('c17');
const G = C17_GEOMETRY.c17;
const R = C17_RAMP;
ok('c17: in the roster as a military transport with a cargo ramp, not a giant',
  !!type && type.cargoRamp === true && type.transport === true && type.military === true && type.freighter === true && !type.minRunway && type.takeoffFlaps === 2);
ok('c17: its geometry and doors are in the shared tables', AIRLINER_GEOMETRY.c17 === G && AIRLINER_DOORS.c17 === C17_DOORS.c17);
ok('c17: the real size — 53.04 m long, 51.75 m across', Math.abs(G.length - 53.04) < 0.01 && Math.abs(G.span - 51.75) < 0.01, `${G.length} x ${G.span}`);
ok('c17: the drawn tail strike is past 13 degrees on main wheels 4 m aft (the belly swept up for the ramp)', G.strike.deg > 13 && G.main.z === 4.0, `${G.strike.deg.toFixed(2)} deg at z ${G.strike.z.toFixed(1)}`);
ok('c17: the wheelbase is the real 20.05 m', Math.abs(G.main.z - G.nose.z - 20.05) < 0.01, `${(G.main.z - G.nose.z).toFixed(2)} m`);
const floorUp = R.floorY - G.ground;
ok('c17: the cargo floor rides 1.5-2.5 m above the ground (the real one 1.6)', floorUp > 1.5 && floorUp < 2.5, `${floorUp.toFixed(2)} m`);
ok('c17: the ramp is the real 6.05 m and reaches the ground from the hinge', Math.abs(R.length - 6.05) < 0.01 && R.length > floorUp, `${R.length} m for ${floorUp.toFixed(2)} m of height`);
ok('c17: the hold is the real 5.49 x 3.76 m to 5 cm, and ends at the hinge inside the body', Math.abs(R.holdWidth - 5.49) < 0.05 && Math.abs(R.holdHeight - 3.76) < 0.05 && R.hingeZ < G.noseZ + G.length - 10 && R.holdFront > G.noseZ + 8);
ok('c17: the ramp, the door and the hinge are in order along the body', R.hingeZ < R.rampEnd && R.rampEnd < R.doorEnd && R.doorEnd < G.noseZ + G.length);
ok('c17: thrust-to-weight 0.4 and blown-flap lift (CL0 0.44), the short-field numbers', Math.abs(type.aero.thrustMax / (type.aero.mass * 9.80665) - 0.4) < 0.02 && type.aero.CL0 >= 0.44);
const perf = T.performanceFor('c17');
ok('c17: approach 70-80 kt, 300-350 kt on the red line, over five hours of fuel', perf.stallLanding >= 70 && perf.stallLanding <= 80 && perf.vne >= 300 && perf.vne <= 350 && perf.enduranceMin > 300, JSON.stringify(perf));

/* ------------------------------------------------------------------ *
 * The model
 * ------------------------------------------------------------------ */
const model = ADAPTER.createAircraftModel({ type, livery: LIV.schemeFor(type, 'house') });
model.updateMatrixWorld(true);
ok('c17: drawn by its own hand-built model', !!model.userData.fleetBridge && model.userData.aircraftId === 'c17' && ADAPTER.fleetCovers('c17'));
const cargo = model.userData.cargo;
ok('c17: the model exports the ramp API (open, close, toggle, set, amount, state)',
  !!cargo && ['open', 'close', 'toggle', 'set', 'amount'].every((k) => typeof cargo[k] === 'function') && typeof cargo.state === 'string' && typeof cargo.isOpen === 'boolean');

const byMaterial = (name) => {
  const out = [];
  model.traverse((o) => {
    if (o.isMesh && o.material && o.material.name === name) out.push(o);
  });
  return out;
};
ok('c17: the opening is cut out of the tail skin (whole triangles removed along the loft\'s own lines)', cargo.removed > 100 && cargo.removed < 600, `${cargo.removed} triangles`);
ok('c17: the hold is furnished — floor, walls, roof, ribs, rollers, lights, pallets, a liner, a frame round the door',
  ['C17_hold', 'C17_cargo_floor', 'C17_hold_lights', 'C17_pallet', 'C17_liner', 'C17_door_frame', 'C17_ramp_skin'].every((n) => byMaterial(n).length > 0),
  ['C17_hold', 'C17_cargo_floor', 'C17_hold_lights', 'C17_pallet', 'C17_liner', 'C17_door_frame', 'C17_ramp_skin'].map((n) => `${n} ${byMaterial(n).length}`).join(', '));
ok('c17: the ramp and the cargo door wear the livery with the decal offset, so their edges never flicker against the skin',
  byMaterial('C17_ramp_skin').every((m) => m.material.map && m.material.polygonOffset === true && m.material.polygonOffsetFactor < 0));

// A triangle budget a school laptop can draw, and a modest number of draws.
let tris = 0;
let draws = 0;
model.traverse((o) => {
  if (o.isMesh && o.geometry) {
    const g = o.geometry;
    tris += ((g.index ? g.index.count : g.attributes.position.count) / 3) * (o.isInstancedMesh ? o.count : 1);
    draws++;
  }
});
ok('c17: under 15,000 triangles and 110 draws, hold and all', tris < 15000 && draws < 110, `${Math.round(tris)} triangles, ${draws} meshes`);

// Shut by default; opens in its time; the toe meets the ground; shuts again.
const step = (s) => model.userData.update(s, { rpm: 0, gearPos: 1, gearDown: true, onGround: true }, {});
ok('c17: the ramp is shut when the aeroplane is built', cargo.state === 'closed' && cargo.amount() === 0 && !cargo.isOpen);
cargo.open();
step(0.5);
ok('c17: open() starts it moving', cargo.state === 'opening' && cargo.amount() > 0 && cargo.amount() < 0.2, `${cargo.amount().toFixed(2)} after 0.5 s`);
for (let i = 0; i < 2 * R.openSeconds + 2; i++) step(0.5);
ok(`c17: and it is open in about ${R.openSeconds} s`, cargo.state === 'open' && cargo.isOpen && cargo.amount() === 1);
model.updateMatrixWorld(true);
const inv = new THREE.Matrix4().copy(model.matrixWorld).invert();
const deck = cargo.nodes.ramp.children.find((c) => c.name === 'Ramp deck');
const toe = new THREE.Vector3(0, 0.1, cargo.length);
deck.localToWorld(toe).applyMatrix4(inv);
ok('c17: open, the ramp\'s toe is on the ground, behind the hinge', Math.abs(toe.y - G.ground) < 0.3 && toe.z > R.hingeZ + 4, `toe y ${r2(toe.y)} (ground ${G.ground}), z ${r2(toe.z)}`);
ok('c17: the ramp slopes down at 15-30 degrees', cargo.angles.open * DEG > 15 && cargo.angles.open * DEG < 30, `${(cargo.angles.open * DEG).toFixed(1)} deg`);
// The cargo door, swung up: every bit of it inside the body — below the crown, inside the sides, above the floor.
{
  const box = new THREE.Box3();
  cargo.nodes.door.traverse((o) => {
    if (o.isMesh) {
      o.geometry.computeBoundingBox();
      const b = o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld).applyMatrix4(inv);
      box.union(b);
    }
  });
  ok('c17: the open cargo door is up inside the body (under the crown, within the sides, above the floor, ahead of the tail)',
    box.max.y < 4.0 && box.min.y > R.floorY && box.max.x < 3.3 && box.min.x > -3.3 && box.min.z > R.hingeZ,
    `x ${r2(box.min.x)}..${r2(box.max.x)}, y ${r2(box.min.y)}..${r2(box.max.y)}, z ${r2(box.min.z)}..${r2(box.max.z)}`);
}
// Looking in from behind: a ray through the opening reaches the hold; with the ramp shut, it meets the ramp.
{
  const meshes = [];
  model.traverse((o) => {
    if (o.isMesh && !o.isInstancedMesh && o.visible) meshes.push(o);
  });
  const look = (from, to) => {
    const dir = new THREE.Vector3().subVectors(to, from).normalize();
    const rc = new THREE.Raycaster(from, dir, 0, 200);
    const hit = rc.intersectObjects(meshes, false)[0];
    if (!hit) return null;
    const p = hit.point.clone().applyMatrix4(inv);
    return { name: hit.object.name, mat: hit.object.material && hit.object.material.name, p };
  };
  // From behind, under the tail cone and over the lowered ramp, a little downhill into the hold.
  // (A little off the centreline: a ray exactly along the seam where the two half-patches meet is on an edge both triangles exclude.)
  const from = new THREE.Vector3(0.3, -0.6, 40);
  const to = new THREE.Vector3(0.3, -1.6, 10);
  const open = look(from, to);
  ok('c17: ramp down, a look in from behind sees into the hold (the bulkhead, the floor, a pallet), not the sky or the skin',
    !!open && open.p.z < R.hingeZ && ['C17_hold', 'C17_pallet', 'C17_cargo_floor', 'C17_liner'].includes(open.mat), open ? `${open.name} (${open.mat}) at z ${r2(open.p.z)}` : 'nothing hit');
  cargo.close({ instant: true });
  model.updateMatrixWorld(true);
  const shut = look(from, to);
  ok('c17: ramp up, the same look meets the ramp or the cargo door — the skin is whole again',
    !!shut && shut.mat === 'C17_ramp_skin', shut ? `${shut.name} (${shut.mat}) at z ${r2(shut.p.z)}` : 'nothing hit');
}
ok('c17: close() shuts it; set(0.5) puts it half way; toggle() opens it again',
  cargo.state === 'closed' && (cargo.set(0.5), cargo.amount() === 0.5) && cargo.toggle() === true && cargo.state === 'opening');
cargo.close({ instant: true });

// The sponsons, the winglets and the T-tail are there; fourteen tyres; four engines.
{
  let tyres = 0;
  model.traverse((o) => {
    if (o.isInstancedMesh && /tyre/i.test(o.name)) tyres += o.count;
  });
  ok('c17: fourteen tyres (two on the nose, three pairs in each sponson) and four engines', tyres === 14 && model.userData.parts.engines.length === 4, `${tyres} tyres, ${model.userData.parts.engines.length} engines`);
  // The winglets share the nacelle grey with the flap-track canoes on each wing, so the
  // airframe's batchStatic merges them into the wing's assembly: look for the shape, not the name.
  const tipRise = (s) => {
    const v = new THREE.Vector3();
    let lo = Infinity, hi = -Infinity;
    model.traverse((o) => {
      if (!o.isMesh || o.isInstancedMesh) return;
      const p = o.geometry.attributes.position;
      for (let i = 0; i < p.count; i++) {
        v.fromBufferAttribute(p, i).applyMatrix4(o.matrixWorld);
        if (s * v.x > G.span / 2 - 0.4) { lo = Math.min(lo, v.y); hi = Math.max(hi, v.y); }
      }
    });
    return hi - lo;
  };
  const rises = [tipRise(-1), tipRise(1)];
  ok('c17: winglets on both tips (over 2.5 m of upturned tip each side)', rises.every((r) => r > 2.5 && r < 4), rises.map((r) => `${r.toFixed(2)} m`).join(', '));
  const tail = model.userData.config.tail;
  const fin = model.userData.config.fin;
  ok('c17: a T-tail — the tailplane sits on the fin\'s tip, 16.8 m up', Math.abs(tail.rootY - (fin.rootY + fin.height)) < 0.3 && Math.abs(fin.rootY + fin.height - G.ground - 16.79) < 0.5,
    `tailplane y ${tail.rootY}, fin tip ${fin.rootY + fin.height}, height ${(fin.rootY + fin.height - G.ground).toFixed(2)} m`);
}
// Nothing below the wheels, the aeroplane stands on them.
ok('c17: drawn tyres meet the physics contact points', Math.abs(ADAPTER.groundOffsetFor(model, T.specFor('c17'))) < 0.03);
// The animation runs with no throw, ramp moving and all.
{
  let threw = null;
  try {
    cargo.open();
    for (let i = 0; i < 40; i++) model.userData.update(1 / 30, { rpm: 0.8, gearPos: i < 20 ? 1 : 0.4, onGround: i < 10, controls: { pitch: 0.2, roll: -0.1, yaw: 0 }, vel: new THREE.Vector3(0, 0, -50) }, {});
  } catch (e) {
    threw = e;
  }
  ok('c17: animates with the ramp moving without throwing', !threw, threw ? String(threw) : '');
}
model.userData.dispose();

/* ------------------------------------------------------------------ *
 * cutOpening on its own
 * ------------------------------------------------------------------ */
{
  // A ring of quads: z from 0 to 2 (three rings), angle 0..pi in 6 columns, both sides folded to one.
  const pos = [];
  const idx = [];
  const rings = [0, 1, 2];
  const cols = 7;
  for (const z of rings) for (let k = 0; k < cols; k++) {
    const s = (k / (cols - 1)) * Math.PI;
    pos.push(Math.sin(s), Math.cos(s), z);
  }
  for (let r = 0; r < rings.length - 1; r++) for (let k = 0; k < cols - 1; k++) {
    const a = r * cols + k;
    const b = a + 1;
    const c = a + cols + 1;
    const d = a + cols;
    idx.push(a, b, c, a, c, d);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  const angleOf = (z, y) => Math.acos(Math.max(-1, Math.min(1, y)));
  const cut = cutOpening(geo, angleOf, { z0: 0, z1: 1, s0: Math.PI / 2 });
  // The first ring of quads (z 0..1): columns whose far vertex is past 90 degrees go — 3 of 6 quads, 6 triangles.
  ok('cutOpening: removes exactly the triangles in the band and past the angle, keeps every other', cut.userData.removed === 6 && cut.index.count === idx.length - 18, `${cut.userData.removed} removed, ${cut.index.count / 3} left of ${idx.length / 3}`);
}

/* ------------------------------------------------------------------ *
 * The rule, and the key
 * ------------------------------------------------------------------ */
ok('ramp rule: on the ground it opens, whatever the speed', RULE.rampRule({ onGround: true, kt: 0, target: 0 }).action === 'opening' && RULE.rampRule({ onGround: true, kt: 90, target: 0 }).action === 'opening');
ok('ramp rule: in the air under 150 kt it opens, and says to stay under 150', RULE.rampRule({ onGround: false, kt: 140, target: 0 }).action === 'opening' && /150/.test(RULE.rampRule({ onGround: false, kt: 140, target: 0 }).note));
ok('ramp rule: in the air over 150 kt it is refused, with the reason', RULE.rampRule({ onGround: false, kt: 180, target: 0 }).action === 'refused' && /Too fast/.test(RULE.rampRule({ onGround: false, kt: 180, target: 0 }).note));
ok('ramp rule: open or opening, a press closes it, at any speed', RULE.rampRule({ onGround: false, kt: 300, target: 1 }).action === 'closing' && RULE.rampRule({ onGround: true, kt: 0, target: 1 }).action === 'closing');
ok('ramp rule: open and over 165 kt in the air, it shuts itself; not on the ground, not when shut', RULE.rampMustShut({ onGround: false, kt: 170, target: 1 }) && !RULE.rampMustShut({ onGround: true, kt: 170, target: 1 }) && !RULE.rampMustShut({ onGround: false, kt: 170, target: 0 }) && !RULE.rampMustShut({ onGround: false, kt: 160, target: 1 }));
{
  const a = INPUT.ACTIONS && INPUT.ACTIONS.cargoRamp;
  ok('ramp key: a Flying action for aeroplanes, 6 by default, rebindable in Settings like every key', !!a && a.group === 'Flying' && a.ctx.includes('plane') && a.default[0] === 'Digit6', a ? JSON.stringify(a) : 'no action');
  // No other aeroplane action shares the key by default.
  const clash = Object.entries(INPUT.ACTIONS || {}).filter(([id, d]) => id !== 'cargoRamp' && d.ctx.includes('plane') && d.default.includes('Digit6'));
  ok('ramp key: no other aeroplane action is on 6', clash.length === 0, clash.map(([id]) => id).join(', '));
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

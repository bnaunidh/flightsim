/**
 * features/cockpit-plus (the owner: "improve cockpits a lot"), headless, on
 * every cockpit in the roster:
 *
 *   - a pilot sits in every room but T-Pose Harrison's: hands on the controls,
 *     boots on the pedals, one draw
 *   - each hand is ON its grip, and stays on it when the stick, the wheel, the
 *     throttle or the collective moves (the fist's centre is the grip's centre;
 *     the forearm reaches the wrist)
 *   - nothing of the pilot within 12 cm of the eye, in either cockpit view
 *   - every round dial gets one bezel and one glass; none on Low's glass
 *   - Low: no more than 3 more draws and 4,000 more triangles than the room
 *   - at night the room goes dark under its roof and the flood comes up; by day
 *     every colour is back exactly as it was
 */
global.document = {
  createElement: () => ({
    getContext: () =>
      new Proxy(
        { measureText: (t) => ({ width: String(t).length * 6 }), roundRect: () => {} },
        { get: (o, k) => (k in o ? o[k] : () => ({ addColorStop() {}, data: new Uint8ClampedArray(4) })), set: () => true }
      ),
    width: 0,
    height: 0,
    style: {},
  }),
  body: { appendChild() {} },
};

const SRC = new URL('../../src/', import.meta.url).href;
const THREE = await import(SRC + 'vendor/three.module.js');
const { AIRCRAFT, getAircraft } = await import(SRC + 'aircraft/types.js');
const adapter = await import(SRC + 'aircraft/model-adapter.js');
const { schemeFor } = await import(SRC + 'aircraft/liveries.js');
const CP = await import(SRC + 'aircraft/cockpit.js');
const { TRAINER_EYE } = await import(SRC + 'aircraft/cockpit/common.js');
const { plus } = await import(SRC + 'features/cockpit-plus/index.js');
const { relMatrix } = await import(SRC + 'features/cockpit-plus/pilot.js');
const { NIGHT } = await import(SRC + 'features/cockpit-plus/night.js');

const results = [];
const ok = (name, pass, detail = '') => results.push({ name, pass: !!pass, detail: String(detail) });

function seated(id) {
  const type = getAircraft(id);
  const S = type.shape;
  const model = adapter.createAircraftModel({ type, livery: schemeFor(type, 'house') });
  const cockpit = CP.createCockpit({ type, model });
  const host = model || new THREE.Group();
  const k = host.userData.fleetBridge ? 1 : S.scale;
  const eye = adapter.eyeFor(host, [S.eye[0] * S.scale, S.eye[1] * S.scale, S.eye[2] * S.scale]);
  cockpit.scale.setScalar(1 / k);
  cockpit.position.set((eye[0] - TRAINER_EYE[0]) / k, (eye[1] - TRAINER_EYE[1]) / k, (eye[2] - TRAINER_EYE[2]) / k);
  if (!model) host.scale.setScalar(k);
  host.add(cockpit);
  host.updateMatrixWorld(true);
  return { type, cockpit };
}

/** Draws and triangles of what a camera on layer 0 would draw of `root`. */
function cost(root) {
  let draws = 0;
  let tris = 0;
  root.traverseVisible((o) => {
    if (!o.isMesh || !(o.layers.mask & 1)) return;
    draws++;
    const g = o.geometry;
    tris += ((g.index ? g.index.count : g.attributes.position.count) / 3) * (o.isInstancedMesh ? o.count : 1);
  });
  return { draws, tris: Math.round(tris) };
}

const AC = () => ({
  controls: { throttle: 0.6, pitch: 0, roll: 0, yaw: 0, brakes: 0 },
  ias: 50, alt: 600, vs: 0, heading: 90, rpm: 0.7, engineOn: true, gearDown: true, flaps: 0, fuel: 100, failures: {},
  pos: new THREE.Vector3(0, 600, 0), vel: new THREE.Vector3(0, 0, -50), quat: new THREE.Quaternion(), airspeed: 50,
  bankAngleDeg: () => 0, forward: (v) => v.set(0, 0, -1),
});
const DAY = { time: 'day', cond: { cloud: 0, rain: 0 } };
const NIGHT_W = { time: 'night', cond: { cloud: 0, rain: 0 } };

const _a = new THREE.Vector3();
const _m = new THREE.Matrix4();
/** How far each hand's fist is from its grip, and the forearm's end from the wrist (metres). */
function handsOn(cp, pilot) {
  let worst = 0;
  let gap = 0;
  for (const h of pilot.hands) {
    const c = new THREE.Vector3();
    if (h.g.multi) {
      for (const t of h.g.multi) c.add(_a.copy(t.g.c).applyMatrix4(relMatrix(cp, t.lv, _m)));
      c.divideScalar(h.g.multi.length);
    } else c.copy(h.g.c).applyMatrix4(relMatrix(cp, h.g.o, _m));
    worst = Math.max(worst, c.distanceTo(h.hb.position));
    // The forearm's far end (its bone's +y, at its length times its stretch) against the wrist.
    const end = new THREE.Vector3(0, 0.29 * h.fa.scale.y, 0).applyQuaternion(h.fa.quaternion).add(h.fa.position);
    const wrist = new THREE.Vector3(0, 0, h.g.r + 0.085).applyQuaternion(h.hb.quaternion).add(h.hb.position);
    gap = Math.max(gap, end.distanceTo(wrist), h.fa.scale.y - 1 > 0.25 ? 1 : 0);
  }
  return { worst, gap };
}

/** The pilot's nearest vertex to `eye`, skinned by hand (each vertex wholly on one bone; the mesh sits at the cockpit's origin). */
function nearest(mesh, eye) {
  const P = mesh.geometry.attributes.position;
  const I = mesh.geometry.attributes.skinIndex;
  const bones = mesh.skeleton.bones;
  for (const b of bones) b.updateMatrix();
  let best = Infinity;
  const v = new THREE.Vector3();
  for (let i = 0; i < P.count; i++) {
    v.fromBufferAttribute(P, i).applyMatrix4(bones[I.getX(i)].matrix);
    best = Math.min(best, v.distanceTo(eye));
  }
  return best;
}

const roster = AIRCRAFT.map((t) => t.id);
const families = {};
for (const id of roster) {
  let s;
  try {
    s = seated(id);
  } catch (e) {
    ok(`cockpit plus: ${id} builds`, false, e.message);
    continue;
  }
  const cp = s.cockpit;
  const fam = cp.userData.family;
  families[fam] = (families[fam] || 0) + 1;
  for (const low of [false, true]) {
    if (low) {
      // A fresh room for Low.
      s = seated(id);
    }
    const room = s.cockpit;
    const before = cost(room);
    const made = plus(room, null, { low, fill: [], fillLevel: () => 0.08 });
    const after = cost(room);
    const tag = `${id}${low ? ' (Low)' : ''}`;
    if (fam === 'none') {
      ok(`cockpit plus: ${tag}: Harrison gets no pilot (he is his own)`, !made.pilot);
      continue;
    }
    ok(`cockpit plus: ${tag}: a pilot sits in the ${fam} room`, !!made.pilot && made.pilot.hands.length >= 1 && made.pilot.legs.length === (made.pilot.legs.length ? 2 : 0), made.pilot ? `${made.pilot.hands.length} hands, ${made.pilot.legs.length} legs` : 'none');
    if (!made.pilot) continue;
    const ac = AC();
    room.userData.update(1 / 30, ac, DAY, null);
    let h = handsOn(room, made.pilot);
    ok(`cockpit plus: ${tag}: each hand is on its grip`, h.worst < 1e-3 && h.gap < 0.02, `fist ${h.worst.toFixed(4)} m from the grip, forearm ${h.gap.toFixed(3)} m from the wrist`);
    ac.controls = { throttle: 1, pitch: 0.8, roll: -0.9, yaw: 0.8, brakes: 0 };
    for (let i = 0; i < 40; i++) room.userData.update(1 / 30, ac, DAY, null);
    h = handsOn(room, made.pilot);
    ok(`cockpit plus: ${tag}: ...and stays on it with the controls moved`, h.worst < 1e-3 && h.gap < 0.02, `${h.worst.toFixed(4)} / ${h.gap.toFixed(3)}`);
    {
      // What the GPU will draw (three's own skinning maths) is each piece at its bone.
      const mesh = made.pilot.mesh;
      room.updateMatrixWorld(true);
      mesh.skeleton.update();
      const P = mesh.geometry.attributes.position;
      const I = mesh.geometry.attributes.skinIndex;
      let worst = 0;
      const a = new THREE.Vector3();
      const b = new THREE.Vector3();
      for (let i = 0; i < P.count; i += 97) {
        mesh.getVertexPosition(i, a).applyMatrix4(mesh.matrixWorld);
        b.fromBufferAttribute(P, i).applyMatrix4(mesh.skeleton.bones[I.getX(i)].matrixWorld);
        worst = Math.max(worst, a.distanceTo(b));
      }
      ok(`cockpit plus: ${tag}: the pilot is drawn where his bones are`, worst < 1e-4, worst.toExponential(1));
    }
    const E = new THREE.Vector3(...TRAINER_EYE);
    made.pilot.update(0, false);
    const n0 = nearest(made.pilot.mesh, E);
    made.pilot.update(0, true);
    const near = Math.min(n0, nearest(made.pilot.mesh, E.clone().add(new THREE.Vector3(0, -0.02, 0.16).divideScalar(room.scale.x))));
    made.pilot.update(0, false);
    ok(`cockpit plus: ${tag}: nothing of the pilot within 12 cm of the eye`, near > 0.12, `${near.toFixed(3)} m`);
    const dials = (room.userData.panel && room.userData.panel.dials) || [];
    const uniq = new Set(dials.map(([u, v]) => `${u.toFixed(3)},${v.toFixed(3)}`)).size;
    const bez = made.bezels.find((m) => m.name === 'instrument bezels');
    const glass = made.bezels.find((m) => m.name === 'instrument glass');
    ok(`cockpit plus: ${tag}: every round dial has a bezel${low ? '' : ' and a glass'}`, !uniq || (bez && bez.count === uniq && (low ? !glass : glass && glass.count === uniq)), `${uniq} dials`);
    ok(`cockpit plus: ${tag}: ${low ? 'Low' : 'High'} costs at most ${low ? 2 : 3} draws more`, after.draws - before.draws <= (low ? 2 : 3), `${before.draws} -> ${after.draws} draws, ${before.tris} -> ${after.tris} triangles`);
    if (low) ok(`cockpit plus: ${tag}: Low adds under 4,000 triangles`, after.tris - before.tris < 4000, `+${after.tris - before.tris}`);
    if (!low) {
      // Night and back.
      const n = made.night;
      const lit = n.mats.filter((x) => x.flood && !x.own);
      for (let i = 0; i < 60; i++) room.userData.update(1 / 10, ac, NIGHT_W, null);
      const darker = n.mats.every((x) => Math.abs(x.m.color.r - x.color.r * NIGHT.roof) < 1e-4);
      const flooded = lit.every((x) => x.m.emissive.r > 0 && x.m.emissiveIntensity > 0);
      const off = n.mats.filter((x) => Math.abs(x.m.color.r - x.color.r * NIGHT.roof) >= 1e-4).map((x) => { let who = ''; room.traverse((o) => { if (!who && o.material === x.m) who = o.name || (o.parent && o.parent.name) || o.type; }); return `${who}:${x.color.getHexString()}->${x.m.color.getHexString()}`; });
      ok(`cockpit plus: ${tag}: at night the room is dark under its roof, and the flood lights the panel`, darker && flooded && lit.length > 0, `${n.mats.length} materials, ${lit.length} flooded; not dark: ${off.slice(0, 4).join()}`);
      for (let i = 0; i < 60; i++) room.userData.update(1 / 10, ac, DAY, null);
      const back = n.mats.every((x) => x.m.color.equals(x.color) && (x.own || x.flood || x.m.emissive.equals(x.emissive)));
      ok(`cockpit plus: ${tag}: by day every colour is back as it was`, back);
    }
  }
}
ok('cockpit plus: every family was seen', ['light', 'airliner', 'jet', 'heli'].every((f) => families[f] > 0), JSON.stringify(families));

const failed = results.filter((r) => !r.pass);
for (const r of results) console.log(`${r.pass ? 'ok  ' : 'FAIL'}  ${r.name}${r.detail ? '  — ' + r.detail : ''}`);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) process.exitCode = 1;

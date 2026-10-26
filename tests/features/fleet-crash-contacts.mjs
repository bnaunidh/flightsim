/**
 * The pack's crash body on fewer contact points (src/fleet/common.js
 * supportPoints; the replay QA, 2026-10-25, .claude/devtools/briefs/replay-qa.md).
 *
 * With Reduce flashing on — the default — breakup.js leaves the pack's
 * aeroplanes their own crash body, and that body had every vertex of the
 * drawing as a contact: an A380 sliding after a wing-tip crash cost 110-175
 * ms a frame (and so did every replay frame of it). Now it rests on the
 * outside of the shape: the extreme point in 98 directions plus the
 * outermost point of each cell of a coarse grid.
 *
 *   node tests/features/fleet-crash-contacts.mjs
 */
globalThis.document = { createElement: () => ({ getContext: () => null, style: {} }) };
const root = new URL('../../src/', import.meta.url);
const THREE = await import(new URL('vendor/three.module.js', root).href);
const C = await import(new URL('fleet/common.js', root).href);
const P = await import(new URL('fleet/physics.js', root).href);

let pass = 0;
let fail = 0;
const ok = (name, cond, detail = '') => {
  if (cond) pass++;
  else fail++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail !== '' ? '  — ' + detail : ''}`);
};

// A dense airliner-ish cloud: a fuselage tube 70 m long, a wing 80 m across, a fin 20 m up — 20,000-odd surface points.
const pts = [];
for (let i = 0; i <= 140; i++) for (let a = 0; a < 48; a++) {
  const z = -35 + i * 0.5;
  const t = (a / 48) * Math.PI * 2;
  pts.push(new THREE.Vector3(Math.cos(t) * 3.5, Math.sin(t) * 3.5, z));
}
for (let i = 0; i <= 160; i++) for (let j = 0; j <= 20; j++) pts.push(new THREE.Vector3(-40 + i * 0.5, -1 + (j % 2) * 0.6, -6 + j * 0.5));
for (let i = 0; i <= 40; i++) for (let j = 0; j <= 20; j++) pts.push(new THREE.Vector3((j % 2) * 0.4 - 0.2, 3 + i * 0.5, 26 + j * 0.4));

const kept = C.supportPoints(pts);
ok('a dense cloud (thousands of vertices) is kept as a few hundred contact points', pts.length > 10000 && kept.length >= 60 && kept.length <= 640, `${pts.length} → ${kept.length}`);
const b0 = new THREE.Box3().setFromPoints(pts);
const b1 = new THREE.Box3().setFromPoints(kept);
ok('…with the same box: the nose, the tail, both wing tips and the fin top are all kept', b0.min.distanceTo(b1.min) < 1e-9 && b0.max.distanceTo(b1.max) < 1e-9);
ok('…every one of them a point of the shape (none made up)', kept.every((p) => pts.includes(p)));
ok('a small cloud is left exactly as it is', C.supportPoints(pts.slice(0, 200)).length === 200);

// The same body dropped flat on the ground on both clouds: it comes to rest at the same height and the same attitude.
function drop(points) {
  const c = new THREE.Box3().setFromPoints(points).getCenter(new THREE.Vector3());
  const local = points.map((p) => p.clone().sub(c));
  const size = new THREE.Box3().setFromPoints(local).getSize(new THREE.Vector3());
  const m = 200000;
  const inertia = new THREE.Vector3(size.y ** 2 + size.z ** 2, size.x ** 2 + size.z ** 2, size.x ** 2 + size.y ** 2).multiplyScalar(m / 12);
  const body = P.createGroundBody({ position: new THREE.Vector3(0, 6, 0), quaternion: new THREE.Quaternion().setFromEuler(new THREE.Euler(0.02, 0, 0.03)), velocity: new THREE.Vector3(8, -2, 0), massKg: m, inertia, points: local, groundHeight: 0, friction: 0.65, restitution: 0.08 });
  const t0 = performance.now();
  for (let i = 0; i < 30 * 12 && !body.sleeping; i++) body.update(1 / 30);
  return { y: body.position.y, x: body.position.x, tilt: new THREE.Vector3(0, 1, 0).applyQuaternion(body.quaternion).angleTo(new THREE.Vector3(0, 1, 0)), ms: performance.now() - t0, asleep: body.sleeping };
}
const full = drop(pts);
const few = drop(kept);
ok('dropped on the ground, it rests at the same height on either (within 5 cm)', Math.abs(full.y - few.y) < 0.05, `${full.y.toFixed(3)} vs ${few.y.toFixed(3)} m`);
ok('…in the same attitude (within a degree) and slides about as far (within 10%)', Math.abs(full.tilt - few.tilt) < Math.PI / 180 && Math.abs(full.x - few.x) <= Math.max(0.5, Math.abs(full.x) * 0.1), `tilt ${(full.tilt * 57.3).toFixed(2)} vs ${(few.tilt * 57.3).toFixed(2)} deg, slid ${full.x.toFixed(2)} vs ${few.x.toFixed(2)} m`);
ok('…and costs a small fraction of the time (under a fifth)', few.ms < full.ms / 5, `${full.ms.toFixed(0)} ms → ${few.ms.toFixed(0)} ms for the whole slide`);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

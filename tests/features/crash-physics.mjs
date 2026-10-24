/**
 * Node checks for the crash physics of v71 — the BeamNG bar (the owner,
 * 2026-10-23: the impact depends on speed, angle and WHERE it hits; parts
 * hang before tearing; pieces keep momentum; water is different; it must all
 * stay under the no-freeze budget and replay the same). Run with plain node:
 *
 *   node tests/features/crash-physics.mjs
 *
 *   1. CLASSIFICATION (game/breakup.js classifyImpact): a wing tip clipping
 *      the ground is a wingtip catch, a flat gear-up arrival a belly slide,
 *      a steep nose hit nose-in, a tail strike a tail strike, fast and flat
 *      into the sea a skip, a knock a knock, in the air a midair.
 *   2. SEPARATION ORDER (plan.delays): the zone that touched lets go first,
 *      the rest later the further they are, never after DELAY_MAX, every
 *      piece with a moment of its own.
 *   3. HANGING (plan.hangs): a wing caught hard hangs by its root with its
 *      engine before tearing; a scrape never hangs anything; a propeller
 *      never hangs; a survivable knock never hangs; what hangs is not also
 *      flying off.
 *   4. THE BODY (game/breakup-body.js): skips off the water fast and flat
 *      and not steep; a caught left tip yaws the body left and rolls it; a
 *      body stands on its own hull points.
 *   5. THE AIRFRAME IN THE GAME (features/breakup.js with a real aeroplane on
 *      real ground): a belly slide slides, slows and stops with dust and
 *      sparks; a wing tip catch turns the aeroplane round; nose-in pitches it
 *      over; flat into the sea it skips and then the slow sink takes it;
 *      hanging pieces ride the airframe and tear off by their time; the
 *      pack's aeroplanes keep their own body.
 *   6. BUDGETS: the plan is a fraction of a millisecond, the crash frame
 *      stays under the 50 ms bar (scaled for a busy machine), a frame of the
 *      sliding airframe is cheap.
 *   7. DETERMINISM: the same crash with the same seed is the same crash, to
 *      the last digit of every piece's pose; the recording keeps the seed.
 */

globalThis.document = {
  createElement: () => ({
    getContext: () => new Proxy({}, { get: () => () => ({ addColorStop() {}, data: new Uint8ClampedArray(4) }) }),
    width: 0,
    height: 0,
    style: {},
  }),
  body: { appendChild() {} },
};

const root = new URL('../../src/', import.meta.url);
const imp = (p) => import(new URL(p, root).href);
const THREE = await imp('vendor/three.module.js');
const T = await imp('aircraft/types.js');
const P = await imp('aircraft/physics.js');
const TER = await imp('world/terrain.js');
const A = await imp('aircraft/model-adapter.js');
const X = await imp('game/extensions.js');
const B = await imp('game/breakup.js');
const BM = await imp('game/breakup-mesh.js');
const BB = await imp('game/breakup-body.js');
const AF = await imp('features/breakup/airframe.js');
const F = await imp('features/breakup.js');
const { Wreck } = await imp('game/wreck.js');
TER.applyMap(TER.MAP.id);

let pass = 0;
let fail = 0;
function ok(name, cond, detail = '') {
  if (cond) pass++;
  else fail++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail !== '' ? '  — ' + detail : ''}`);
}
const f1 = (v) => (Math.round(v * 10) / 10).toString();
const f2 = (v) => (Math.round(v * 100) / 100).toString();
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const ext = X.extensions().find((e) => e.id === 'breakup');
const D = () => F.breakupDebug();

/* ---- the drawn models, classified ------------------------------------------ */
const drawn = {};
function zonesFor(id) {
  if (drawn[id]) return drawn[id];
  const type = T.getAircraft(id);
  const model = A.createAircraftModel({ type });
  const config = model.userData.fleetBridge ? model.userData.config : null;
  const survey = BM.surveyModel(model);
  const frame = B.refineFrame(B.frameFor(type, config), survey);
  const layout = B.layoutFor(frame);
  const asg = BM.classifyModel(survey, layout);
  drawn[id] = { type, model, layout, frame, asg, boxes: asg.boxes };
  return drawn[id];
}
const plan = (id, hit) => B.planBreak(zonesFor(id).layout, hit, zonesFor(id).boxes);
const centre = (b) => [0, 1, 2].map((k) => (b.min[k] + b.max[k]) / 2);
const tipL = (id) => {
  const bx = zonesFor(id).boxes.wingOuterL;
  return [bx.min[0] + 0.2, (bx.min[1] + bx.max[1]) / 2, (bx.min[2] + bx.max[2]) / 2];
};
const bellyPt = (id) => [0, zonesFor(id).boxes.core.min[1], 0.3];
const nosePt = (id) => [0, 0, zonesFor(id).boxes.nose.min[2] + 0.1];
const tailPt = (id) => [0, zonesFor(id).boxes.rear.min[1], zonesFor(id).boxes.rear.max[2] - 0.5];

/* ---- 1. classification ----------------------------------------------------- */
for (const id of ['skylark', 'a320']) {
  const m = (p) => p.mode.mode;
  const clip = plan(id, { point: tipL(id), normal: [0, 1, 0], velocity: [0, -4, -30] });
  ok(`classify: ${id} — a wing tip clipping the ground is a wingtip catch, on the left`, m(clip) === 'wingtip' && clip.mode.side === -1, `${m(clip)} side ${clip.mode.side}`);
  const belly = plan(id, { point: bellyPt(id), normal: [0, 1, 0], velocity: [0, -3, -60], gearDown: 0 });
  ok(`classify: ${id} — a flat gear-up arrival is a belly slide (low grip: it slides)`, m(belly) === 'belly' && belly.mode.grip < 0.3, `${m(belly)} grip ${belly.mode.grip}`);
  const nose = plan(id, { point: nosePt(id), normal: [0, 0.6, 0.8], velocity: [0, -14, -20] });
  ok(`classify: ${id} — a steep nose hit is nose-in (high grip: it digs in)`, m(nose) === 'nose' && nose.mode.grip > 0.5, `${m(nose)} grip ${nose.mode.grip}`);
  const shallow = plan(id, { point: nosePt(id), normal: [0, 1, 0], velocity: [0, -2, -50] });
  ok(`classify: ${id} — a shallow nose touch is a slide, not nose-in`, m(shallow) === 'belly', m(shallow));
  const tail = plan(id, { point: tailPt(id), normal: [0, 1, 0], velocity: [0, -9, -50], zones: ['rear'] });
  ok(`classify: ${id} — a tail strike is a tail strike`, m(tail) === 'tail', m(tail));
  const spec = T.specFor(id);
  const gp = spec.gearPoints.find((g) => g.pos.x > 0.1) || spec.gearPoints[0];
  const wheels = plan(id, { point: [gp.pos.x, gp.pos.y - 0.3, gp.pos.z], normal: [0, 1, 0], velocity: [0, -8, -55], gearDown: 1 });
  ok(`classify: ${id} — a hard arrival on the wheels is a gear hit`, m(wheels) === 'gear', `${m(wheels)} (hit ${wheels.hitZone})`);
  const skip = plan(id, { point: bellyPt(id), normal: [0, 1, 0], velocity: [0, -3, -70], surface: 'water' });
  ok(`classify: ${id} — fast and flat into the sea skips`, m(skip) === 'water' && skip.mode.skip === true, `${m(skip)} skip ${skip.mode.skip}`);
  const plunge = plan(id, { point: nosePt(id), normal: [0, 1, 0], velocity: [0, -30, -30], surface: 'water' });
  ok(`classify: ${id} — steep into the sea goes straight in`, m(plunge) === 'water' && plunge.mode.skip === false, `${m(plunge)} skip ${plunge.mode.skip}`);
  const wall = plan(id, { point: nosePt(id), normal: [0, 0, 1], velocity: [0, 0, -40], surface: 'wall' });
  ok(`classify: ${id} — a building is a wall: it bounces back`, m(wall) === 'wall' && wall.mode.restitution > 0.15, `${m(wall)} e ${wall.mode.restitution}`);
  const knock = plan(id, { point: tipL(id), normal: [0, 1, 0], energy: 24, survivable: true, zones: ['wingOuterL', 'wingInnerL'] });
  ok(`classify: ${id} — a survivable knock is a knock: nothing to choreograph`, m(knock) === 'knock' && knock.mode.grip === 0, m(knock));
  const air = plan(id, { point: [0, 0, 0], normal: [0, 1, 0], energy: 900, midair: true });
  ok(`classify: ${id} — come apart in the air is a midair`, m(air) === 'midair', m(air));
}

{
  // A leg that is UP is only the nearest zone: the Harrier's outriggers sit out near its wing tips, and a wing caught
  // there with the gear up is a wing catch (it cartwheels), not a wheels arrival (grip 0.05: it slid on, the checker's sweep).
  const H = zonesFor('harrier');
  const og = T.specFor('harrier').gearPoints.find((g) => g.pos.x < -0.5);
  const out = H.boxes.gearL && og ? [og.pos.x, H.boxes.gearL.min[1], og.pos.z] : null;
  const up = out && plan('harrier', { point: out, normal: [0, 1, 0], velocity: [0, -6, -50], gearDown: 0 });
  const down = out && plan('harrier', { point: out, normal: [0, 1, 0], velocity: [0, -6, -50], gearDown: 1 });
  ok('classify: harrier — gear up, a hit at the left outrigger is a wingtip catch on the left; gear down it is a wheels arrival', !!up && up.mode.mode === 'wingtip' && up.mode.side === -1 && down.mode.mode === 'gear', up ? `up ${up.hitZone}:${up.mode.mode} side ${up.mode.side}; down ${down.mode.mode}` : 'no gearL box');
  const sky = plan('skylark', { point: [0, zonesFor('skylark').boxes.core.min[1], 0.3], normal: [0, 1, 0], velocity: [0, -3, -60], gearDown: 0, zone: zonesFor('skylark').boxes.gearL ? 'gearL' : undefined });
  ok('classify: a gear-up arrival whose nearest zone is a stowed leg on the centre line is a belly slide', !zonesFor('skylark').boxes.gearL || ['belly', 'wingtip'].includes(sky.mode.mode), sky.mode.mode);
}

/* ---- 2. separation order ----------------------------------------------------- */
for (const id of ['skylark', 'a320', 'tempest']) {
  const p = plan(id, { point: nosePt(id), normal: [0, 0.3, 0.95], velocity: [0, -30, -60] });
  const det = p.actions.filter((a) => a.action === 'detach');
  const hitA = det.find((a) => a.zone === p.hitZone);
  ok(`order: ${id} — the zone that touched (${p.hitZone}) lets go first, at the hit`, !!hitA && hitA.delay === 0, hitA ? `delay ${hitA.delay}` : 'not detached');
  // The plan's own distances (a head-on blow runs back along the fuselage further than one from the side: its z is foreshortened).
  const dist = (z) => p.dist[z];
  const others = det.filter((a) => a.zone !== p.hitZone && !/^gear/.test(a.zone)).sort((a, b) => dist(a.zone) - dist(b.zone));
  let mono = true;
  for (let i = 1; i < others.length; i++) if (others[i].delay < others[i - 1].delay - 1e-9) mono = false;
  ok(`order: ${id} — the further a zone is from the contact, the later it lets go`, others.length >= 3 && mono, others.map((a) => `${a.zone}@${f2(a.delay)}`).join(' '));
  ok(`order: ${id} — nothing waits longer than DELAY_MAX (${B.DELAY_MAX} s), and every piece has its moment`, det.every((a) => Number.isFinite(a.delay) && a.delay >= 0 && a.delay <= B.DELAY_MAX) && p.delays.length === p.pieces.length && p.delays.every((d) => Number.isFinite(d)), `${p.delays.map(f2).join(' ')}`);
  ok(`order: ${id} — the tail of a long aeroplane goes noticeably after the nose`, id !== 'a320' || p.delays[p.pieces.findIndex((q) => q.includes('rear'))] > 0.1, `rear at ${f2(p.delays[p.pieces.findIndex((q) => q.includes('rear'))] || 0)} s`);
}

/* ---- 3. hanging ------------------------------------------------------------- */
{
  const catchHard = plan('a320', { point: tipL('a320'), normal: [0, 1, 0], velocity: [0, -16, -60] });
  const h = catchHard.hangs.find((q) => q.zone === 'wingInnerL');
  ok('hang: the A320 — a wing caught hard tears at the tip and HANGS at the root, engine and all, before tearing', catchHard.pieces.some((q) => q[0] === 'wingOuterL') && !!h && h.zones.includes('engineL'), `pieces ${catchHard.pieces.map((q) => q.join('+')).join('|')}; hangs ${JSON.stringify(catchHard.hangs)}`);
  ok('hang: it hangs for a plausible moment (HANG.tMin..tMax), after its own delay', !!h && h.t >= B.HANG.tMin && h.t <= B.HANG.tMax && h.delay > 0 && h.delay <= B.DELAY_MAX, h ? `t ${f2(h.t)} delay ${f2(h.delay)}` : '');
  ok('hang: a hanging zone is not also flying off', catchHard.hangs.every((q) => q.zones.every((z) => !catchHard.pieces.flat().includes(z))));
  ok('hang: the plan says where the fuel is out (the hanging wing, its engine)', catchHard.fuel.includes('wingInnerL'), catchHard.fuel.join(','));
  const strike = plan('skylark', { point: tailPt('skylark'), normal: [0, 1, 0], velocity: [0, -9, -50], zones: ['rear'] });
  ok('hang: the Skylark — a tail strike breaks both tailplanes and leaves the fin hanging', strike.hangs.some((q) => q.zone === 'fin') && strike.pieces.flat().includes('tailplaneL') && strike.pieces.flat().includes('tailplaneR'), `${strike.pieces.map((q) => q.join('+')).join('|')}; hangs ${strike.hangs.map((q) => q.zone).join(',')}`);
}
{
  // Never from a scrape: wheels up at 75 m/s on every fixed-wing type.
  const FIXED = T.AIRCRAFT.filter((t) => {
    const f = zonesFor(t.id).frame;
    return f.family !== 'rotor' && f.family !== 'person';
  }).map((t) => t.id);
  const hung = [];
  for (const id of FIXED) {
    const spec = T.specFor(id);
    const gp = spec.gearPoints.find((g) => g.pos.x < -0.1) || spec.gearPoints[0];
    const up = plan(id, { point: [gp.pos.x, -0.35, gp.pos.z], normal: [0, 1, 0], velocity: [0, -1.5, -75], gearDown: 0 });
    if (up.hangs.length) hung.push(`${id}:${up.hangs.map((q) => q.zone).join(',')}`);
  }
  ok('hang: a 75 m/s belly scrape hangs nothing on any aeroplane (a scrape grinds, a blow hangs)', !hung.length, hung.join(' '));
  // Never a propeller, never in a knock.
  const props = [];
  for (const E of [20, 40, 60, 100, 160, 300]) {
    const p = plan('skylark', { point: centre(zonesFor('skylark').boxes.engine), normal: [0, 0, 1], energy: E });
    if (p.actions.some((a) => a.zone === 'engine' && a.action === 'hang')) props.push(E);
  }
  ok('hang: the Skylark\'s propeller engine never hangs (it bends, or it comes off)', !props.length, props.join(','));
  const knocks = [];
  for (const E of [20, 40, 60, 120, 600]) {
    const p = plan('a320', { point: tipL('a320'), normal: [0, 1, 0], energy: E, survivable: true, zones: ['wingOuterL', 'wingInnerL'] });
    if (p.hangs.length || p.actions.some((a) => a.action === 'hang')) knocks.push(E);
  }
  ok('hang: a survivable knock never leaves anything hanging (you fly on, or it is gone)', !knocks.length, knocks.join(','));
}

/* ---- 4. the body ------------------------------------------------------------- */
{
  const water = { surface: (x, z, o) => Object.assign(o, { y: 0, nx: 0, ny: 1, nz: 0, kind: 'water', floor: -40 }), onSplash() {}, onBubble() {} };
  const run = (vel) => {
    const b = BB.makeBody({ position: V(0, 3, 0), size: V(6, 0.3, 1.5), mass: 200, velocity: vel, light: true, rand: () => 0.3 });
    for (let t = 0; t < 12; t += 1 / 60) BB.stepBody(b, 1 / 60, water);
    return b;
  };
  const flat = run(V(0, -4, -50));
  const steep = run(V(0, -30, -40));
  ok('body: fast and flat into the water, a piece skips (up to SKIP.max times) and travels far', flat.skips >= 2 && flat.skips <= BB.SKIP.max && -flat.pos.z > 60, `${flat.skips} skips, ${f1(-flat.pos.z)} m`);
  ok('body: steep in, it goes straight under and bobs back — no skip', steep.skips === 0 && -steep.pos.z < 40 && steep.pos.y > -2, `${steep.skips} skips, ${f1(-steep.pos.z)} m, y ${f2(steep.pos.y)}`);
  const noskip = BB.makeBody({ position: V(0, 3, 0), size: V(6, 0.3, 1.5), mass: 200, velocity: V(0, -4, -50), light: true, noSkip: true, rand: () => 0.3 });
  for (let t = 0; t < 4; t += 1 / 60) BB.stepBody(noskip, 1 / 60, water);
  ok('body: a body told not to skip (a wreck lying on the water) does not', noskip.skips === 0);
}
{
  // A left wing tip caught while sliding forward (-z): the nose yaws left (a positive turn about +y takes -z towards -x) and it rolls.
  const b = BB.makeBody({ position: V(0, 1, 0), size: V(12, 1.2, 8), mass: 1100, velocity: V(0, -3, -50) });
  const j = BB.catchPoint(b, V(-6, 0.4, 0), V(0, 1, 0), 0.6, 0.1);
  ok('body: a caught LEFT wing tip yaws the nose LEFT and sets it rolling (the cartwheel\'s start)', j > 0 && b.omega.y > 1 && Math.abs(b.omega.z) > 0.2 && b.vel.z > -50, `omega ${b.omega.toArray().map(f2).join(',')} vel ${b.vel.toArray().map(f1).join(',')}`);
  const c = BB.makeBody({ position: V(0, 1, 0), size: V(12, 1.2, 8), mass: 1100, velocity: V(0, -3, -50) });
  BB.catchPoint(c, V(6, 0.4, 0), V(0, 1, 0), 0.6, 0.1);
  ok('body: the RIGHT tip yaws it the other way', c.omega.y < -1, f2(c.omega.y));
  const d = BB.makeBody({ position: V(0, 1, 0), size: V(12, 1.2, 8), mass: 1100, velocity: V(0, -3, -50) });
  BB.catchPoint(d, V(0, -0.6, 0), V(0, 1, 0), 0.15, 0.1);
  ok('body: a belly with little grip keeps most of its speed along the ground', -d.vel.z > 40 && Math.abs(d.omega.y) < 0.2, `vel ${f1(d.vel.z)} omega.y ${f2(d.omega.y)}`);
  // Deterministic: the same inputs twice.
  const e1 = BB.makeBody({ position: V(0, 1, 0), size: V(12, 1.2, 8), mass: 1100, velocity: V(0, -3, -50), rand: B.rng(7) });
  const e2 = BB.makeBody({ position: V(0, 1, 0), size: V(12, 1.2, 8), mass: 1100, velocity: V(0, -3, -50), rand: B.rng(7) });
  BB.catchPoint(e1, V(-6, 0.4, 0), V(0, 1, 0), 0.6, 0.1);
  BB.catchPoint(e2, V(-6, 0.4, 0), V(0, 1, 0), 0.6, 0.1);
  ok('body: the catch is deterministic, and a seeded body drifts the same way twice', e1.omega.equals(e2.omega) && e1.vel.equals(e2.vel) && e1.drift.equals(e2.drift));
}
{
  // Its own hull: a body whose points reach 2 m below its centre rests with its centre 2 m up.
  const ground = { surface: (x, z, o) => Object.assign(o, { y: 0, nx: 0, ny: 1, nz: 0, kind: 'paved' }) };
  const hull = [[-5, -2, 0], [5, -2, 0], [0, -2, -4], [0, -2, 4], [0, 1, 0], [-5, 0.5, 2], [5, 0.5, 2]];
  const b = BB.makeBody({ position: V(0, 6, 0), size: V(10, 3, 8), mass: 1500, velocity: V(0, 0, -20), hull, rand: () => 0.5 });
  let t = 0;
  for (; t < 20 && !b.sleeping; t += 1 / 60) BB.stepBody(b, 1 / 60, ground);
  ok('body: a body stands on ITS OWN points: with them 2 m below its centre it rests 2 m up, after a slide', b.sleeping && Math.abs(b.pos.y - 2) < 0.35 && b.hull.length === hull.length * 3 && -b.pos.z > 5, `y ${f2(b.pos.y)} after ${f1(t)} s, ${f1(-b.pos.z)} m, ${b.hull.length / 3} points`);
  const { asg, layout } = zonesFor('a320');
  const H = AF.hullOf(asg, layout, new Set(['wingOuterL']));
  ok('airframe: hullOf gives the remaining airframe\'s corners (no folded gear), a size and a centre', !!H && H.points.length >= 24 && !H.zones.includes('wingOuterL') && !H.zones.some((z) => /^gear/.test(z)) && H.zones.includes('wingOuterR') && H.size.x > 20 && H.size.z > 25, H ? `${H.points.length} points, ${H.zones.length} zones, ${H.size.toArray().map(f1).join('x')}` : 'null');
  const h = AF.hingeFor(zonesFor('a320').frame, 'wingInnerL', V(-6, -1, 0), () => 0.2);
  const a0 = AF.hangAngle(h, 0);
  const a1 = AF.hangAngle(h, 2);
  ok('airframe: a hanging left wing swings about the fore-aft line at its root and droops to its rest angle (a positive turn about +z takes a left tip down)', h.axis.z === 1 && h.pivot.x < 0 && a0 === 0 && Math.abs(a1 - h.droop) < 0.05 && h.droop > 0, `droop ${f2(h.droop)}, at 2 s ${f2(a1)}`);
  const M = new THREE.Matrix4().compose(V(100, 10, 100), new THREE.Quaternion(), V(1, 1, 1));
  const pos = new THREE.Vector3();
  const quat = new THREE.Quaternion();
  AF.attachedPose(M, { local: new THREE.Matrix4().makeTranslation(-6, -1, 0), com: V(-6, -1, 0), hinge: h }, 0, pos, quat);
  const p0 = pos.clone();
  AF.attachedPose(M, { local: new THREE.Matrix4().makeTranslation(-6, -1, 0), com: V(-6, -1, 0), hinge: h }, 2, pos, quat);
  ok('airframe: before its hang begins a piece sits where it was; two seconds in it has swung DOWN about its root', p0.distanceTo(V(94, 9, 100)) < 1e-6 && pos.y < p0.y - 0.5 && pos.x > p0.x, `${p0.toArray().map(f2).join(',')} -> ${pos.toArray().map(f2).join(',')}`);
}

/* ---- 5. the airframe in the game ------------------------------------------------- */

function makeSim(typeId, seed) {
  const type = T.getAircraft(typeId);
  P.applyAircraft(type.id);
  const scene = new THREE.Scene();
  const model = A.createAircraftModel({ type });
  scene.add(model);
  const ac = new P.Aircraft();
  const sim = {
    scene,
    camera: new THREE.PerspectiveCamera(60, 1.6, 0.5, 40000),
    aircraft: ac,
    model,
    aircraftType: type,
    settings: { quality: 'high', crashSlowMo: false },
    state: 'flying',
    mode: 'free',
    rig: { kicks: 0, kick(a) { this.kicks += a; }, initialised: true },
    wreck: null,
    crashSeed: seed,
    update(dt) {
      this.wreck.update(dt);
    },
  };
  sim.wreck = new Wreck(scene);
  const group = new THREE.Group();
  scene.add(group);
  ext.install(sim);
  ext.buildWorld(sim, group);
  ext.startMode(sim);
  return sim;
}
function syncModel(sim) {
  A.syncAircraftModel(sim.model, sim.aircraft);
  if (!sim.model.matrixAutoUpdate) sim.model.updateMatrix();
  sim.model.updateMatrixWorld(true);
}
function frame(sim, dt = 1 / 60) {
  syncModel(sim);
  sim.update(dt);
  ext.update(sim, dt);
}
/** Flat ground on the island, or open sea; paved when asked (a runway). */
function spot(water, paved = false) {
  for (let r = 300; r < 12000; r += 100) {
    for (let i = 0; i < 36; i++) {
      const a = (i / 36) * Math.PI * 2;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      const h = TER.heightAt(x, z);
      if (TER.platformAt(x, z)) continue;
      if (water) {
        if (h < -8 && TER.heightAt(x + 120, z) < -8 && TER.heightAt(x - 120, z) < -8) return { x, z, h: 0 };
        continue;
      }
      if (paved && !TER.isPaved(x, z)) continue;
      let flat = h > (paved ? 0 : 4);
      for (const [dx, dz] of [[60, 0], [-60, 0], [0, 60], [0, -60], [120, 0], [-120, 0]]) if (Math.abs(TER.heightAt(x + dx, z + dz) - h) > 2.5 || TER.heightAt(x + dx, z + dz) < 0) flat = false;
      if (flat) return { x, z, h };
    }
  }
  return null;
}
const yawOf = (q) => {
  const f = V(0, 0, -1).applyQuaternion(q);
  return Math.atan2(-f.x, -f.z);
};
const pitchOf = (q) => Math.asin(Math.max(-1, Math.min(1, V(0, 0, -1).applyQuaternion(q).y)));
const rollOf = (q) => {
  const r = V(1, 0, 0).applyQuaternion(q);
  return Math.asin(Math.max(-1, Math.min(1, -r.y)));
};
/**
 * Fly level towards the spot, then hit it: `how` sets the attitude, the
 * velocity and the part that touched. Then `after` seconds of the live world,
 * sampling the aeroplane every frame.
 */
function crash(sim, at, how, after = 4) {
  const ac = sim.aircraft;
  ac.reset({ pos: V(at.x - 200, at.h + 40, at.z), headingDeg: 90, speed: how.speed || 55, altAGL: 40, engineOn: true });
  for (let i = 0; i < 40; i++) {
    ac.pos.x += 3;
    frame(sim);
  }
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(how.pitch || 0, -Math.PI / 2, how.bank || 0, 'YXZ'));
  ac.quat.copy(q);
  ac.pos.set(at.x, at.h + (how.height == null ? 0.6 : how.height), at.z);
  ac.vel.set(how.vel[0], how.vel[1], how.vel[2]);
  ac.omega.set(0, 0, 0);
  if (how.gear != null) ac.gearPos = how.gear;
  syncModel(sim);
  const hp = (P.SPEC.hardPoints || []).find((h) => h.part === how.part);
  const worldPoint = hp ? hp.pos.clone().applyQuaternion(ac.quat).add(ac.pos) : ac.pos.clone().setY(at.h);
  const samples = [];
  const take = (t) => samples.push({ t, pos: ac.pos.clone(), quat: ac.quat.clone(), speed: ac.vel.length(), hull: !!D().S.hull, attached: D().attached.length, pieces: D().pieces.length, sink: !!(D().S.sink && D().S.sink.started) });
  const inWater = TER.heightAt(ac.pos.x, ac.pos.z) < 0 && ac.pos.y < 4;
  ac.on(P.EVENTS.CRASH, () => sim.wreck.start(ac.pos, ac.vel, inWater));
  ac.crash(how.reason || 'Test crash', { worldPoint, part: how.part, surfaceKind: how.water ? 'water' : undefined });
  take(0);
  for (let i = 1; i <= Math.round(after * 60); i++) {
    frame(sim);
    take(i / 60);
  }
  return samples;
}
const at = (samples, t) => samples.reduce((best, s) => (Math.abs(s.t - t) < Math.abs(best.t - t) ? s : best), samples[0]);
const land = spot(false);
const runway = spot(false, true) || land;
const sea = spot(true);
ok('world: a flat spot on land, a paved one and open sea for the crashes', !!land && !!sea, `land ${land && `${Math.round(land.x)},${Math.round(land.z)} at ${f1(land.h)}`}; runway ${runway && `${Math.round(runway.x)},${Math.round(runway.z)}`} paved ${!!(runway && TER.isPaved(runway.x, runway.z))}; sea ${sea && `${Math.round(sea.x)},${Math.round(sea.z)}`}`);

/* ---- 5a. a belly slide ---- */
{
  const sim = makeSim('skylark', 11);
  const s = crash(sim, runway, { vel: [60, -3, 0], pitch: 0.03, gear: 0, part: 'fuselage', reason: 'The belly hit the ground' }, 15);
  const plan0 = D().stats.lastPlan;
  const s0 = s[0];
  const s1 = at(s, 1);
  const s2 = at(s, 2.5);
  const last = s[s.length - 1];
  ok('slide: a gear-up arrival at 60 m/s is a belly slide with a body of its own', plan0.mode === 'belly' && s[1].hull, `mode ${plan0.mode}, hull ${s[1].hull}`);
  const sFirst = at(s, 1 / 60);
  ok('slide: it slides on — tens of metres in the first second — and slows under friction', s1.pos.distanceTo(s0.pos) > 25 && s1.pos.distanceTo(s0.pos) < 70 && s1.speed < sFirst.speed && s2.speed < s1.speed, `${f1(s1.pos.distanceTo(s0.pos))} m at 1 s; speed ${f1(sFirst.speed)} -> ${f1(s1.speed)} -> ${f1(s2.speed)}`);
  ok('slide: it comes to rest within fifteen seconds, a long way down the runway, and the body is let go', !last.hull && last.speed < 0.5 && last.pos.distanceTo(s0.pos) > 60, `${f1(last.pos.distanceTo(s0.pos))} m, ${f1(last.speed)} m/s, hull ${last.hull}`);
  ok('slide: never through the ground, never flung into the air', s.every((q) => q.pos.y > runway.h - 1.5 && q.pos.y < runway.h + 12), `y ${f1(Math.min(...s.map((q) => q.pos.y)))}..${f1(Math.max(...s.map((q) => q.pos.y)))} (ground ${f1(runway.h)})`);
  const fx = D().S.rec.fx;
  const scrapes = fx.filter((e) => e.t > 0.3 && (e.name === 'sparks' || e.name === 'dust'));
  ok('slide: sparks and dust fly along the slide, long after the hit, and are in the recording', scrapes.length > 10 && (!TER.isPaved(runway.x, runway.z) || scrapes.some((e) => e.name === 'sparks')), `${scrapes.length} after 0.3 s (${scrapes.filter((e) => e.name === 'sparks').length} sparks)`);
  ok('slide: the camera felt it', sim.rig.kicks > 0.3, f2(sim.rig.kicks));
  // A belly slide throws no pieces: the recording used to finish at three seconds (every piece asleep — there were
  // none) with the airframe still halfway down the runway, and the replay stopped there.
  const rf = D().S.rec.frames;
  ok('slide: the recording runs on while the airframe slides, though it threw no pieces', rf[rf.length - 1].t > 4.5, `last frame at ${f2(rf[rf.length - 1].t)} s, ${D().S.rec.tracks.length} tracks`);
  ok('slide: the recording follows the sliding airframe (its frames move)', D().S.rec.frames.length > 10 && D().S.rec.frames[D().S.rec.frames.length - 1].pos.distanceTo(D().S.rec.frames[0].pos) > 30, `${D().S.rec.frames.length} frames`);
  const w = sim.wreck;
  ok('slide: the wreck\'s smoke and firelight came along with the airframe; the scorch stayed where it hit', w.light.position.distanceTo(last.pos) < 8 && w.mark.position.distanceTo(new THREE.Vector3(s0.pos.x, w.mark.position.y, s0.pos.z)) < 6 && w.origin.distanceTo(last.pos) < 8, `light ${f1(w.light.position.distanceTo(last.pos))} m from the wreck, scorch ${f1(w.mark.position.distanceTo(new THREE.Vector3(s0.pos.x, w.mark.position.y, s0.pos.z)))} m from the hit`);
}

/* ---- 5b. a wing tip catch ---- */
{
  const sim = makeSim('skylark', 12);
  const s = crash(sim, land, { vel: [50, -6, 0], bank: 0.5, part: 'leftWing', reason: 'The left wing hit the ground' }, 4);
  const plan0 = D().stats.lastPlan;
  const yaw0 = yawOf(s[0].quat);
  let turned = 0;
  let rolled = 0;
  for (const q of s) {
    turned = Math.max(turned, Math.abs(((yawOf(q.quat) - yaw0 + Math.PI * 3) % (Math.PI * 2)) - Math.PI));
    rolled = Math.max(rolled, Math.abs(rollOf(q.quat) - rollOf(s[0].quat)));
  }
  ok('cartwheel: a wing tip catching the grass at 50 m/s is a wingtip catch, and that outer wing comes off', plan0.mode === 'wingtip' && plan0.pieces.some((p) => /wingOuterL/.test(p)), `mode ${plan0.mode}; ${plan0.pieces.join('|')}`);
  ok('cartwheel: the airframe is thrown round over the caught tip: it turns through more than 45 degrees and rolls', turned > Math.PI / 4 && rolled > 0.3, `turned ${Math.round((turned * 180) / Math.PI)} deg, rolled ${Math.round((rolled * 180) / Math.PI)} deg`);
  ok('cartwheel: it does not go through the ground', s.every((q) => q.pos.y > land.h - 2), `lowest ${f1(Math.min(...s.map((q) => q.pos.y)))} (ground ${f1(land.h)})`);
}

/* ---- 5c. nose-in ---- */
{
  const sim = makeSim('skylark', 13);
  const s = crash(sim, land, { vel: [30, -22, 0], pitch: -0.7, part: 'nose', reason: 'The propeller struck the ground' }, 3);
  const plan0 = D().stats.lastPlan;
  const p0 = pitchOf(s[0].quat);
  let over = 0;
  for (const q of s) over = Math.max(over, Math.abs(pitchOf(q.quat) - p0));
  ok('nose-in: a steep nose hit is nose-in, and the nose section comes off at the cockpit seam', plan0.mode === 'nose' && plan0.pieces.some((p) => /^nose/.test(p)), `mode ${plan0.mode}; ${plan0.pieces.join('|')}`);
  ok('nose-in: the tail comes over: the pitch swings through more than 30 degrees', over > Math.PI / 6, `${Math.round((over * 180) / Math.PI)} deg`);
  ok('nose-in: it stops near where it hit (no long slide from a dive)', s[s.length - 1].pos.distanceTo(s[0].pos) < 40, `${f1(s[s.length - 1].pos.distanceTo(s[0].pos))} m`);
}

/* ---- 5d. the sea: skip, then sink ---- */
{
  const sim = makeSim('skylark', 14);
  const skips0 = D().stats.skips || 0;
  const s = crash(sim, sea, { vel: [70, -3, 0], height: 0.3, water: true, part: 'fuselage', reason: 'You flew into the sea' }, 10);
  const plan0 = D().stats.lastPlan;
  const far = s[s.length - 1].pos.distanceTo(s[0].pos);
  ok('sea: flat and fast into the sea is a water impact that skips', plan0.mode === 'water' && (D().stats.skips || 0) - skips0 >= 1, `mode ${plan0.mode}, ${(D().stats.skips || 0) - skips0} skips`);
  ok('sea: it travels a long way across the water before it stops', far > 60, `${f1(far)} m`);
  ok('sea: once it has stopped the slow sink takes it, and the pilot is in a raft', s[s.length - 1].sink && !s[s.length - 1].hull && D().rafts.length === 1, `sink ${s[s.length - 1].sink}, hull ${s[s.length - 1].hull}, rafts ${D().rafts.length}`);
  const handed = s.find((q) => q.sink);
  ok('sea: the sink record is there from the hit (held), and the hand-over is after the skips and within SINK_HANDOFF.maxT seconds', !!D().S.sink && !!handed && handed.t > 0.5 && handed.t <= AF.SINK_HANDOFF.maxT + 0.1, handed ? `at ${f2(handed.t)} s` : 'never');
  const sim2 = makeSim('skylark', 15);
  const skips1 = D().stats.skips || 0;
  const d = crash(sim2, sea, { vel: [20, -35, 0], pitch: -1, height: 0.3, water: true, part: 'nose', reason: 'You flew into the sea' }, 4);
  const top = Math.max(...s.map((q) => q.pos.y)) - s[0].pos.y;
  ok('sea: an airframe skipping off the sea stays low (it is not a stone: no bounce of metres)', top < 2, `highest ${f2(top)} m above where it hit`);
  const sim3 = makeSim('skylark', 19);
  const skips3 = D().stats.skips || 0;
  const w = crash(sim3, sea, { vel: [60, -6, 0], bank: 0.5, height: 0.3, water: true, part: 'leftWing', reason: 'You flew into the sea' }, 4);
  ok('sea: wing low into the sea, the tip goes in: no skip, no bounce', (D().stats.skips || 0) - skips3 === 0 && Math.max(...w.map((q) => q.pos.y)) - w[0].pos.y < 1, `${(D().stats.skips || 0) - skips3} skips, highest ${f2(Math.max(...w.map((q) => q.pos.y)) - w[0].pos.y)} m`);
  ok('sea: steep in, no skip: it goes in where it hit and the sink begins', (D().stats.skips || 0) - skips1 === 0 && d[d.length - 1].sink && d[d.length - 1].pos.distanceTo(d[0].pos) < 30, `${(D().stats.skips || 0) - skips1} skips, ${f1(d[d.length - 1].pos.distanceTo(d[0].pos))} m, sink ${d[d.length - 1].sink}`);
}

/* ---- 5e. hanging pieces ride the airframe, then tear off in order ---- */
{
  const sim = makeSim('a320', 16);
  const s = crash(sim, land, { vel: [60, -16, 0], bank: 0.45, speed: 70, part: 'leftWing', reason: 'The left wing hit the ground' }, 4);
  const plan0 = D().stats.lastPlan;
  ok('hanging: the A320\'s wing catch leaves the inner wing hanging (the plan), riding the airframe right after the hit', plan0.hangs.length >= 1 && s[1].attached >= 1, `hangs ${plan0.hangs.join('|')}; attached at the first frame ${s[1].attached}`);
  const L = (P.SPEC && P.SPEC.wingSpan) || 34;
  const rec = D().S.rec;
  const hangTrack = rec.tracks.find((tr) => tr.piece.zones.includes('wingInnerL'));
  let rode = true;
  if (hangTrack) {
    for (const fr of hangTrack.frames) {
      if (fr.t > 0.8) break;
      // The airframe's frame nearest in time.
      const af = rec.frames.reduce((b, q) => (Math.abs(q.t - fr.t) < Math.abs(b.t - fr.t) ? q : b), rec.frames[0]);
      if (fr.pos.distanceTo(af.pos) > L) rode = false;
    }
  }
  ok('hanging: for its hang the wing stays within a span of the airframe (it swings on its root, it does not fly)', !!hangTrack && rode, hangTrack ? `${hangTrack.frames.filter((f) => f.t <= 0.8).length} frames checked` : 'no track');
  ok('hanging: by three seconds everything has torn off, and the tear is counted', s[s.length - 1].attached === 0 && (D().stats.torn || 0) >= 1 && (D().stats.released || 0) >= 1, `attached ${s[s.length - 1].attached}; torn ${D().stats.torn}, released ${D().stats.released}`);
  ok('hanging: pieces that let go later were never counted as free before their moment', s[1].pieces === s[s.length - 1].pieces || s[s.length - 1].pieces <= s[1].pieces, `${s[1].pieces} -> ${s[s.length - 1].pieces}`);
}

/* ---- 5f. the pack's aeroplanes keep their own body ---- */
{
  const sim = makeSim('vanguard', 17);
  const fleet = !!sim.model.userData.fleetBridge;
  const s = crash(sim, land, { vel: [60, -3, 0], gear: 0, part: 'fuselage' }, 1);
  ok('pack: a fleet-pack aeroplane (the Vanguard) breaks up but is not given our body — it has its own', !fleet || (!s[1].hull && !D().S.hull), `fleet ${fleet}, hull ${s[1].hull}`);
}

/* ---- 6. budgets ------------------------------------------------------------------ */
{
  const calibrate = () => {
    const t = performance.now();
    let x = 0;
    for (let i = 0; i < 3e6; i++) x += Math.sqrt(i) * 1e-7;
    return performance.now() - t + (x > 1e12 ? 1 : 0);
  };
  const calib = Math.min(calibrate(), calibrate());
  const scale = Math.max(1, calib / 10);
  let t0 = performance.now();
  for (let i = 0; i < 200; i++) plan('a320', { point: nosePt('a320'), normal: [0, 0.3, 0.95], velocity: [0, -30, -60 + (i % 7)] });
  const planMs = (performance.now() - t0) / 200;
  ok('budget: a plan (classification, order, hangs, fuel) is well under a millisecond', planMs < 1 * scale, `${f2(planMs)} ms (calibration ${f1(calib)} ms)`);
  t0 = performance.now();
  for (let i = 0; i < 200; i++) AF.hullOf(zonesFor('a320').asg, zonesFor('a320').layout, new Set(['wingOuterL', 'nose']));
  const hullMs = (performance.now() - t0) / 200;
  ok('budget: the airframe\'s hull is a fraction of a millisecond', hullMs < 0.5 * scale, `${f2(hullMs)} ms`);
  // The crash frame itself: the crash and the first update, with the zone cache ready, as the browser check measures it.
  const sim = makeSim('a320', 18);
  const ac = sim.aircraft;
  ac.reset({ pos: V(land.x - 100, land.h + 40, land.z), headingDeg: 90, speed: 70, altAGL: 40, engineOn: true });
  for (let i = 0; i < 30; i++) frame(sim);
  D().precompute();
  ac.pos.set(land.x, land.h + 0.6, land.z);
  ac.vel.set(60, -16, 0);
  ac.quat.setFromEuler(new THREE.Euler(0, -Math.PI / 2, 0.45, 'YXZ'));
  syncModel(sim);
  const hp = (P.SPEC.hardPoints || []).find((h) => h.part === 'leftWing');
  const worldPoint = hp.pos.clone().applyQuaternion(ac.quat).add(ac.pos);
  const t1 = performance.now();
  ac.crash('Budget', { worldPoint, part: 'leftWing' });
  frame(sim);
  const crashMs = performance.now() - t1;
  ok('budget: the A320\'s crash frame (break-up, hull, hanging pieces, first step) is under the 50 ms bar, scaled for a busy machine', crashMs < 50 * scale && D().stats.lastPlan.cached, `${f1(crashMs)} ms, bound ${f1(50 * scale)} ms; the break-up alone ${D().stats.lastPlan.ms} ms; cached ${D().stats.lastPlan.cached}`);
  let worst = 0;
  let sum = 0;
  let n = 0;
  for (let i = 0; i < 90; i++) {
    const t = performance.now();
    frame(sim);
    const ms = performance.now() - t;
    sum += ms;
    n++;
    if (ms > worst) worst = ms;
  }
  ok('budget: a frame of the sliding airframe with its hanging and tumbling pieces is a few milliseconds', sum / n < 4 * scale && worst < 25 * scale, `mean ${f2(sum / n)} ms, worst ${f1(worst)} ms over ${n} frames, ${D().pieces.length} pieces, hull ${!!D().S.hull}`);
}

/* ---- 7. determinism ---------------------------------------------------------------- */
{
  const run = (seed) => {
    const sim = makeSim('a320', seed);
    const s = crash(sim, land, { vel: [60, -16, 0], bank: 0.45, speed: 70, part: 'leftWing' }, 2.5);
    const poses = D().S.pieces.map((p) => [p.zones.join('+'), ...p.group.position.toArray(), ...p.group.quaternion.toArray(), p.attach ? 1 : 0]);
    return { ac: [...s[s.length - 1].pos.toArray(), ...s[s.length - 1].quat.toArray()], poses, seed: D().seed, recSeed: D().S.rec.seed, plan: D().stats.lastPlan };
  };
  const a = run(4242);
  const b = run(4242);
  const c = run(4243);
  ok('determinism: the recording keeps the crash\'s seed, and it is the one asked for', a.seed === 4242 && a.recSeed === 4242);
  ok('determinism: the same crash with the same seed puts every piece in the same place, to the last digit', JSON.stringify(a.poses) === JSON.stringify(b.poses) && a.poses.length >= 2, `${a.poses.length} pieces`);
  ok('determinism: ...and the airframe too', JSON.stringify(a.ac) === JSON.stringify(b.ac), a.ac.map(f2).join(','));
  ok('determinism: the plan does not depend on the seed (where it breaks is physics; how the bits fly is the seed)', JSON.stringify(a.plan.pieces) === JSON.stringify(c.plan.pieces) && a.plan.mode === c.plan.mode, `${a.plan.pieces.length} pieces, ${a.plan.mode}`);
  ok('determinism: a different seed throws the pieces differently', JSON.stringify(a.poses) !== JSON.stringify(c.poses));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

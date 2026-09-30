/**
 * The air team's list, checked headless against the real flight model.
 *
 *   node tests/features/aircrew.mjs
 *
 * What it proves:
 *   - every aeroplane in the roster has an escape profile (seat, bail, jump,
 *     or none with kind words), the two-seaters have crew, the special planes
 *     have self-destruct, the fast jets have drag chutes, and every profile
 *     names a uniform that exists;
 *   - every uniform builds as ONE person of eleven draw calls, feet on the
 *     ground, about 1.7 m tall, and Harrison's arms stay out in the T-pose;
 *   - the parachute: a rocket seat saves you from the ground up (zero-zero),
 *     from 600 m, from a Massimo at 900 km/h; the canopy opens, the landing
 *     is gentle (under 5 m/s), steering turns you and "sink" is quicker;
 *   - the drag chute really shortens the landing roll, for every aeroplane
 *     that has one, flown with the same landing as tests/features/fighters.mjs;
 *   - the runaway plane: which planes run away, the rule onfoot.js asks
 *     (idle parks, the first O warns, the second leaves her running);
 *   - T-Pose Harrison: in the roster with his own model, drawn wheels where
 *     the physics lands, stands level, takes off inside the runway, lands and
 *     stops on it, and creeps under 2.5 m/s on the brakes.
 *     (His top speed against Massimo is in fighters.mjs.)
 *
 * Exits non-zero if anything fails.
 */
global.document = {
  createElement: () => ({
    getContext: () => new Proxy({}, { get: () => () => ({ addColorStop() {}, data: new Uint8ClampedArray(4) }) }),
    width: 0, height: 0, style: {},
  }),
  body: { appendChild() {} },
};

const SRC = new URL('../../src/', import.meta.url).href;
const THREE = await import(SRC + 'vendor/three.module.js');
const P = await import(SRC + 'aircraft/physics.js');
const { AIRCRAFT, getAircraft, performanceFor, specFor } = await import(SRC + 'aircraft/types.js');
const { createAircraftModel } = await import(SRC + 'aircraft/model-adapter.js');
const { Weather } = await import(SRC + 'world/weather.js');
const Terrain = await import(SRC + 'world/terrain.js');
const PR = await import(SRC + 'features/eject/profiles.js');
const U = await import(SRC + 'features/uniforms.js');
const CH = await import(SRC + 'features/eject/chute.js');
const DC = await import(SRC + 'features/eject/dragchute.js');
Terrain.applyMap('kestrel');

const KT = 1.94384;
const STEP = 1 / 120;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
let failed = 0;
let passed = 0;
function ok(name, pass, detail = '') {
  if (pass) passed++;
  else failed++;
  console.log(`${pass ? 'ok  ' : 'FAIL'}  ${name}${detail !== '' ? '  —  ' + detail : ''}`);
  return !!pass;
}

/* ------------------------------------------------------------ profiles --- */
{
  const bad = [];
  for (const t of AIRCRAFT) {
    const p = PR.profileFor(t);
    if (!['seat', 'bail', 'jump', 'none'].includes(p.escape)) bad.push(`${t.id}: escape ${p.escape}`);
    if (p.escape === 'none' && !p.noneWhy) bad.push(`${t.id}: no way out and no words for it`);
    if (!U.UNIFORMS[p.uniform]) bad.push(`${t.id}: uniform ${p.uniform}`);
  }
  ok('every aeroplane has an escape profile and a uniform that exists', bad.length === 0, bad.join('; ') || `${AIRCRAFT.length} aeroplanes`);
  const none = AIRCRAFT.filter((t) => PR.profileFor(t).escape === 'none').map((t) => t.id);
  ok('the airliners and the helicopter have no ejection seats (and say so kindly)',
    ['meridian', 'a320', 'b747', 'a380', 'harrier'].every((id) => none.includes(id))
      && /kind|safest|You can do it/i.test(PR.profileFor('a320').noneWhy) && /rotor/i.test(PR.profileFor('harrier').noneWhy),
    none.join(', '));
  ok('the fast jets have rocket seats', ['vanguard', 'f22', 'f35b', 'fa18', 'osprey', 'nightjar', 'massimo'].every((id) => PR.profileFor(id).escape === 'seat'));
  ok('the light aeroplanes bail out of the door', ['skylark', 'courier', 'tempest'].every((id) => PR.profileFor(id).escape === 'bail'));
  ok('T-Pose Harrison jumps off his board', PR.profileFor('tpose').escape === 'jump');
  ok('passengers first: the Nightjar B-2 and the Osprey carry crew with seats of their own',
    PR.profileFor('nightjar').crew >= 1 && PR.profileFor('osprey').crew >= 1 && PR.profileFor('f22').crew === 0);
  ok('self-destruct on the special planes only', ['nightjar', 'f22', 'tpose', 'f35b', 'massimo'].every((id) => PR.profileFor(id).selfDestruct)
    && ['skylark', 'a320', 'harrier', 'fa18', 'vanguard'].every((id) => !PR.profileFor(id).selfDestruct), PR.listed('selfDestruct').join(', '));
  ok('drag chutes on Massimo, Harrison and the fast jets that need them', ['massimo', 'tpose', 'f22', 'vanguard', 'nightjar'].every((id) => PR.profileFor(id).dragChute)
    && !PR.profileFor('skylark').dragChute, PR.listed('dragChute').join(', '));
  ok('uniforms based on planes: captain, fighter, heli, casual, racer, Harrison',
    PR.profileFor('b747').uniform === 'captain' && PR.profileFor('f35b').uniform === 'fighter' && PR.profileFor('harrier').uniform === 'heli'
      && PR.profileFor('skylark').uniform === 'casual' && PR.profileFor('massimo').uniform === 'racer' && PR.profileFor('tpose').uniform === 'harrison');
  ok('an aeroplane nobody listed still gets a sensible answer', PR.profileFor({ id: 'x', class: 'Jumbo airliner' }).escape === 'none'
    && PR.profileFor({ id: 'y', military: true }).escape === 'seat' && PR.profileFor({ id: 'z', shape: { power: { kind: 'prop', rotor: true } } }).escape === 'none');
}

/* ------------------------------------------------------------ uniforms --- */
for (const id of Object.keys(U.UNIFORMS)) {
  const p = U.createUniformPerson(id, { seed: 5 });
  p.updateMatrixWorld(true);
  const b = new THREE.Box3();
  let meshes = 0;
  let nan = 0;
  p.traverse((o) => {
    if (!o.isMesh) return;
    let hidden = false;
    for (let q = o; q; q = q.parent) if (!q.visible) hidden = true;
    if (hidden) return;
    meshes++;
    b.expandByObject(o);
    const a = o.geometry.attributes.position.array;
    for (let i = 0; i < a.length; i++) if (!Number.isFinite(a[i])) nan++;
  });
  ok(`uniform ${id}: one person, at most eleven draw calls, feet on the ground, about 1.7 m tall`,
    meshes <= 11 && nan === 0 && Math.abs(b.min.y) < 0.012 && b.max.y > 1.6 && b.max.y < 1.95,
    `${meshes} meshes, soles ${b.min.y.toFixed(3)} m, top ${b.max.y.toFixed(2)} m`);
  if (id === 'harrison') {
    ok('Harrison: arms straight out in the T-pose, whatever the walk does', !!p.userData.tpose && b.max.x - b.min.x > 1.5 && p.userData.rig.arms.every((a) => !a.arm.visible),
      `${(b.max.x - b.min.x).toFixed(2)} m fingertip to fingertip`);
  }
}
ok('an unknown outfit is not a uniform (the plain person is built instead)', U.createUniformPerson('nope') === null && U.uniformFor('a380') === 'captain');

/* ----------------------------------------------------------- parachute --- */
function drop({ kind = 'seat', agl = 600, speed = 60, input = null, seconds = 400, up = new THREE.Vector3(0, 1, 0) }) {
  const f = new CH.ChuteFlight();
  const ground = 0;
  f.launch(new THREE.Vector3(0, ground + agl, 0), new THREE.Vector3(speed, 0, 0), up, 90, kind);
  let maxOpenSink = 0;
  let landSink = 0;
  let t = 0;
  const inp = input || { turn: 0, sink: false };
  for (; t < seconds && !f.landed; t += 1 / 60) {
    const was = -f.vel.y;
    const landed = f.step(1 / 60, inp, new THREE.Vector3(0, 0, 0), ground);
    if (f.open >= 1) maxOpenSink = Math.max(maxOpenSink, -f.vel.y);
    if (landed) landSink = was;
  }
  return { f, t, landSink, maxOpenSink, dist: Math.hypot(f.pos.x, f.pos.z) };
}
{
  const hi = drop({ agl: 600, speed: 60 });
  ok('seat from 600 m: the canopy opens and you land gently', hi.f.landed && hi.f.open === 1 && hi.landSink < 5,
    `down in ${hi.t.toFixed(0)} s, touching at ${hi.landSink.toFixed(1)} m/s`);
  ok('seat from 600 m: down in under a minute and a quarter (it is a game)', hi.t < 75, `${hi.t.toFixed(0)} s`);
  const zero = drop({ agl: 0.5, speed: 0 });
  ok('zero-zero: fired on the ground, standing still, the seat still saves you', zero.f.landed && zero.f.open > 0.2 && zero.landSink < 6,
    `open ${zero.f.open.toFixed(2)}, touching at ${zero.landSink.toFixed(1)} m/s after ${zero.t.toFixed(1)} s`);
  const fast = drop({ agl: 900, speed: 262 });
  ok('out of Air Massimo at 940 km/h: the air stops you within a few hundred metres, canopy open, gentle landing',
    fast.f.landed && fast.dist < 900 && fast.landSink < 5, `${fast.dist.toFixed(0)} m from where you left, ${fast.landSink.toFixed(1)} m/s at touchdown`);
  const bail = drop({ kind: 'bail', agl: 100, speed: 45 });
  ok('bailing out of a light aeroplane at 100 m: the canopy is open before the ground', bail.f.landed && bail.landSink < 5.5,
    `${bail.landSink.toFixed(1)} m/s at touchdown`);
  const sink = drop({ agl: 600, speed: 60, input: { turn: 0, sink: true } });
  ok('"sink" (S) brings you down faster, still gently at the end', sink.t < hi.t * 0.8 && sink.landSink < 5.5,
    `${sink.t.toFixed(0)} s against ${hi.t.toFixed(0)} s, ${sink.landSink.toFixed(1)} m/s at touchdown`);
  const f = new CH.ChuteFlight().launch(new THREE.Vector3(0, 500, 0), new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 1, 0), 90, 'seat');
  for (let i = 0; i < 180; i++) f.step(1 / 60, { turn: 0, sink: false }, null, 0);
  const h0 = f.heading;
  for (let i = 0; i < 120; i++) f.step(1 / 60, { turn: 1, sink: false }, null, 0);
  ok('steering (D) turns you under the canopy', ((f.heading - h0 + 360) % 360) > 60, `${((f.heading - h0 + 360) % 360).toFixed(0)}° in 2 s`);
}

/* ---------------------------------------------------------- drag chute --- */
function steer(ac) {
  const hdgErr = ((ac.heading - 90 + 540) % 360) - 180;
  const wantBank = clamp(-ac.pos.z * 0.35 - hdgErr * 0.9, -14, 14);
  ac.controls.roll = clamp((wantBank - ac.bankAngleDeg()) / 16, -0.7, 0.7);
  ac.controls.yaw = clamp(-hdgErr / 26, -0.6, 0.6);
}
/** fighters.mjs's landing, braking from touchdown; `chute` pops it on the roll as the game does. */
function land(id, chute, mode = 'simplified') {
  P.applyAircraft(id);
  const ac = new P.Aircraft();
  ac.mode = mode;
  const w = new Weather();
  w.windSpeedKts = 0;
  w.windDirDeg = 90;
  const vapp = Math.max(performanceFor(id).stallLanding * 1.3, performanceFor(id).stallLanding + 15) / KT;
  const AIM = -250;
  const dist = 3500;
  let td = null;
  let stop = null;
  let tdX = null;
  let fill = 0;
  let popped = false;
  let peak = 0;
  ac.on(P.EVENTS.TOUCHDOWN, (g) => { if (!td) { td = g; tdX = ac.pos.x; } });
  ac.reset({ pos: new THREE.Vector3(AIM - dist, 0, 0), headingDeg: 90, engineOn: true, gearDown: true, speed: vapp, altAGL: 50 });
  ac.pos.y = 14 + dist * Math.tan((3.5 * Math.PI) / 180);
  ac.setFlaps(3);
  ac.flaps = 1;
  let thr = 0.4;
  let eInt = 0.1;
  const mass = P.SPEC.mass;
  for (let t = 0; t < 240 && !ac.crashed; t += STEP) {
    if (!td) {
      const toGo = Math.max(30, AIM - ac.pos.x);
      let wantVs = clamp(-(Math.max(0, ac.pos.y - 14) / toGo) * Math.max(10, ac.groundSpeed), -6, -0.5);
      if (ac.agl < 9) wantVs = Math.max(wantVs, -Math.max(0.5, ac.agl * 0.28));
      const err = wantVs - ac.vs;
      eInt = clamp(eInt + err * 0.03 * STEP, -0.4, 0.8);
      ac.controls.pitch = clamp(eInt + err * 0.1 - ac.omega.x * 1.5, -0.8, 1);
      thr = clamp(thr + (vapp - ac.ias) * 0.04 * STEP, 0, 1);
      ac.controls.throttle = ac.agl < 4 ? 0 : clamp(thr + (vapp - ac.ias) * 0.08, 0, 1);
      steer(ac);
    } else {
      ac.controls.throttle = 0;
      ac.controls.pitch = 0;
      ac.controls.roll = 0;
      ac.controls.brakes = 1;
      ac.controls.yaw = clamp(-(((ac.heading - 90 + 540) % 360) - 180) / 20, -1, 1);
    }
    ac.update(STEP, w);
    if (chute && td && ac.onGround) {
      if (!popped && ac.groundSpeed > DC.DRAG_CHUTE.POP_ABOVE) popped = true;
      if (popped && ac.groundSpeed > DC.DRAG_CHUTE.CUT_BELOW) {
        fill = Math.min(1, fill + STEP / DC.DRAG_CHUTE.FILL);
        peak = Math.max(peak, DC.applyChute(ac, mass, fill, STEP));
      }
    }
    if (td && ac.groundSpeed < 2.5 && ac.groundTime > 1.2) {
      stop = ac.pos.x;
      break;
    }
  }
  return { crashed: ac.crashed, reason: ac.crashReason, roll: stop !== null && tdX !== null ? stop - tdX : null, stop, popped, peakG: peak / 9.81 };
}
for (const id of PR.listed('dragChute')) {
  const a = land(id, false);
  const b = land(id, true);
  const cut = a.roll && b.roll ? 1 - b.roll / a.roll : 0;
  ok(`${id}: the drag chute really shortens the landing roll (by a third or more)`,
    !a.crashed && !b.crashed && b.popped && a.roll > 0 && b.roll > 0 && cut >= 0.33 && b.stop < 550,
    `${Math.round(a.roll)} m braking alone, ${Math.round(b.roll)} m with the chute (${Math.round(cut * 100)}% shorter, up to ${b.peakG.toFixed(2)} g from the chute), stopped at x ${Math.round(b.stop)} of 550`);
}
ok('the drag chute pulls harder the faster you go, and nothing at a stop', DC.chuteDecel(40, 5200) > DC.chuteDecel(20, 5200) * 3.9 && DC.chuteDecel(0, 5200) === 0);

/* ------------------------------------------------------ T-Pose Harrison --- */
{
  const t = getAircraft('tpose');
  ok('T-Pose Harrison is in the roster: a special, not military, with his own name, card words and model', t.id === 'tpose' && t.name === 'T-Pose Harrison'
    && t.category === 'special' && !t.military && /T-pose/i.test(t.blurb) && typeof t.buildModel === 'function');
  const model = createAircraftModel({ type: t });
  model.userData.update(0.016, { controls: { throttle: 1, roll: 0 }, rpm: 1, engineOn: true, gearPos: 1, onGround: true, groundSpeed: 0 }, {});
  model.updateMatrixWorld(true);
  const spec = specFor('tpose');
  const wheels = {};
  model.traverse((o) => {
    if (!o.isMesh || !/^wheel:/.test(o.name)) return;
    const b = new THREE.Box3().setFromObject(o);
    wheels[o.name] = { x: (b.min.x + b.max.x) / 2, y: b.min.y, z: (b.min.z + b.max.z) / 2 };
  });
  const pts = Object.fromEntries(spec.gearPoints.map((g) => [g.name, g.pos]));
  const off = ['nose', 'left', 'right'].map((n) => {
    const w = wheels[`wheel:${n}`];
    const p = pts[n];
    return w ? Math.max(Math.abs(w.x - p.x), Math.abs(w.y - p.y), Math.abs(w.z - p.z)) : 99;
  });
  ok('Harrison: the drawn wheels touch exactly where the physics lands', off.every((d) => d < 0.03), off.map((d) => d.toFixed(3)).join(', ') + ' m');
  let rider = null;
  model.traverse((o) => { if (o.name === 'harrison') rider = o; });
  const flame = model.getObjectByName('flame');
  ok('Harrison: a man on a board with a lit rocket, and he can step off it', !!rider && rider.visible && !!flame && flame.visible && flame.scale.z > 1
    && (model.userData.setRider(false), !rider.visible) && (model.userData.setRider(true), rider.visible));
  const W = new Weather();
  W.windSpeedKts = 0;
  // Stands still.
  P.applyAircraft('tpose');
  let ac = new P.Aircraft();
  ac.reset({ pos: new THREE.Vector3(-530, 0, 0), headingDeg: 90, engineOn: true });
  for (let i = 0; i < 360 && !ac.crashed; i++) ac.update(STEP, W);
  ok('Harrison stands on his three wheels when spawned', !ac.crashed && ac.contactCount === 3 && Math.abs(ac.bankAngleDeg()) < 0.5, `pitch ${ac.pitchAngleDeg().toFixed(2)}°`);
  // Takes off.
  for (const mode of ['simplified', 'realistic']) {
    P.applyAircraft('tpose');
    ac = new P.Aircraft();
    ac.mode = mode;
    ac.reset({ pos: new THREE.Vector3(-530, 0, 0), headingDeg: 90, engineOn: true });
    const vr = (performanceFor('tpose').stallClean / KT) * 0.95;
    let lift = null;
    for (let tt = 0; tt < 60 && !ac.crashed; tt += STEP) {
      ac.controls.throttle = 1;
      steer(ac);
      if (ac.ias < vr && ac.onGround) ac.controls.pitch = 0;
      else ac.controls.pitch = clamp((11 - ac.pitchAngleDeg()) * 0.08 - ac.omega.x * 1.2, -1, 1);
      ac.update(STEP, W);
      if (lift === null && !ac.onGround && ac.agl > 1.5) lift = ac.pos.x + 530;
      if (lift !== null && ac.agl > 30) break;
    }
    ok(`Harrison takes off inside the runway (${mode})`, !ac.crashed && lift !== null && lift < 800, `${ac.crashReason || ''} airborne after ${lift === null ? '—' : Math.round(lift)} m`);
    const l = land('tpose', false, mode);
    ok(`Harrison lands and stops on the runway without the chute (${mode})`, !l.crashed && l.stop !== null && l.stop < 550, `${l.reason || ''} stopped at x ${l.stop === null ? '—' : Math.round(l.stop)} of 550`);
  }
  P.applyAircraft('tpose');
  ac = new P.Aircraft();
  ac.reset({ pos: new THREE.Vector3(-400, 0, 0), headingDeg: 90, engineOn: true, speed: 6 });
  ac.parkingBrake = false;
  for (let tt = 0; tt < 20; tt += STEP) { ac.controls.throttle = 0; ac.controls.brakes = 1; ac.update(STEP, W); }
  ok('Harrison can be held below 2.5 m/s at idle on the brakes', ac.groundSpeed < 2.3, `${ac.groundSpeed.toFixed(2)} m/s`);
}

/* -------------------------------------------------------- runaway plane --- */
{
  ok('runaway: the small planes run away (Skylark, Courier), the rest do not',
    PR.profileFor('skylark').runaway && PR.profileFor('courier').runaway
      && ['tempest', 'meridian', 'a320', 'b747', 'a380', 'vanguard', 'f22', 'f35b', 'fa18', 'osprey', 'nightjar', 'massimo', 'tpose', 'harrier'].every((id) => !PR.profileFor(id).runaway),
    AIRCRAFT.filter((t) => PR.profileFor(t).runaway).map((t) => t.id).join(', '));
  const RW = await import(SRC + 'features/runaway.js');
  const rule = RW.runaway.rule;
  const fake = (id, { throttle = 0.6, onGround = true, engineOn = true, mode = 'free', mission = false } = {}) => ({
    state: 'flying', mode, runner: { status: mission ? 'running' : 'idle' }, aircraftType: getAircraft(id),
    aircraft: { onGround, engineOn, crashed: false, controls: { throttle }, pos: new THREE.Vector3(), vel: new THREE.Vector3(), agl: 1, parkingBrake: true },
  });
  ok('runaway: idle power parks her, as ever (no say from the rule)', rule.decide(fake('skylark', { throttle: 0.1 })) === null && rule.maxSpeed(fake('skylark', { throttle: 0.1 })) === 0);
  ok('runaway: engine off parks her', rule.decide(fake('skylark', { engineOn: false })) === null);
  ok('runaway: a fast jet or an airliner with the power on is parked, not left running',
    rule.decide(fake('f22')) === null && rule.decide(fake('a320')) === null && rule.decide(fake('tempest')) === null);
  ok('runaway: in a mission she is parked whatever the lever says', rule.decide(fake('skylark', { mission: true })) === null);
  const sim = fake('skylark');
  ok('runaway: with the power on you may hop out while she rolls (up to 8 m/s)', rule.maxSpeed(sim) === 8);
  const first = rule.decide(sim);
  ok('runaway: the first O only warns — "Power’s still on — she’ll go without you!"', !!(first && first.why && /Power’s still on/.test(first.why) && !first.leave), first && first.why);
  const second = rule.decide(sim);
  ok('runaway: the second O hops you out and leaves her running, flown by the ghost pilot',
    !!(second && second.leave) && RW.runaway.active && sim.override === RW.runaway.ghost && sim.override.throttle >= 0.55 && sim.override.brakes === 0
      && !!(sim.walking && sim.walking.runaway) && Array.isArray(sim.mapPins) && sim.mapPins[0].label === 'YOU');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

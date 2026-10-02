/**
 * The air team's list, checked headless against the real flight model.
 *
 *   node tests/features/aircrew.mjs
 *
 * What it proves:
 *   - every aeroplane in the roster has an escape profile (seat, bail, jump,
 *     or none with kind words), the two-seaters have crew, the special planes
 *     have self-destruct, only the goofy planes (Massimo, Harrison) have a
 *     drag chute — the F-22, Vanguard and Nightjar have none — and every profile
 *     names a uniform that exists;
 *   - every uniform builds as ONE person of eleven draw calls, feet on the
 *     ground, about 1.7 m tall, and Harrison's arms stay out in the T-pose;
 *   - the parachute: a rocket seat saves you from the ground up (zero-zero),
 *     from 600 m, from a Massimo at 900 km/h; the canopy opens, the landing
 *     is gentle (under 5 m/s), steering turns you and "sink" is quicker;
 *   - the drag chute comes out ONLY when it is pulled: Massimo and Harrison
 *     landed braking alone never get one; pulled half a second after
 *     touchdown it takes a third or more off the roll (the same landing as
 *     tests/features/fighters.mjs); in the F-22, Vanguard and Nightjar a pull
 *     does nothing and says why; the rule (dragchute.js chuteBlocker) has no
 *     brakes in it; the key is a named action on ; (free), shown as ;;
 *   - the runaway plane: which planes run away, the rule onfoot.js asks
 *     (idle parks, the first O warns, the second leaves her running);
 *   - T-Pose Harrison: in the roster with his own model — a man floating
 *     head-first, no board, no wheels, nothing drawn under him; parked, he
 *     hovers HOVER_GAP clear of the ground the flight model rests him on,
 *     level, bobbing; his head is the nose, his hands the wing tips, his eyes
 *     the cockpit; his arms follow the flaps (straight T at flaps up, cupped
 *     and flapping with them out, a beat as they move, never a hand into the
 *     ground); he spins on the spin pattern and winds down belly-down; the
 *     vapour and shock cones come with Mach 1; the flight model still takes
 *     him off inside the runway, lands and stops him on it, creeps under
 *     2.5 m/s on the brakes; his stalling speeds with and without flaps.
 *     (His top speed against Massimo is in fighters.mjs; his spin climb and
 *     boost in tpose.mjs.)
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
const HM = await import(SRC + 'aircraft/models/tpose-harrison.js');
const SIG = await import(SRC + 'features/tpose/signal.js');
const heightAtFn = Terrain.heightAt;
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
  ok('the airliners have no ejection seats (and say so kindly)',
    ['meridian', 'a320', 'b747', 'a380'].every((id) => none.includes(id)) && /kind|safest|You can do it/i.test(PR.profileFor('a320').noneWhy),
    none.join(', '));
  const heliFree = PR.profileIn('harrier', 'free');
  const heliMission = PR.profileIn('harrier', 'mission');
  ok('the helicopter: out of the side door in Free Flight, higher than an aeroplane’s door, and it does not fly on without you',
    heliFree.escape === 'bail' && heliFree.bailFrom > PR.profileIn('skylark', 'free').bailFrom && !heliFree.runaway && heliFree.uniform === 'heli',
    JSON.stringify({ escape: heliFree.escape, bailFrom: heliFree.bailFrom, runaway: heliFree.runaway }));
  ok('the helicopter in a mission: as it always was — no way out, and the rotor words',
    heliMission.escape === 'none' && /rotor/i.test(heliMission.noneWhy) && !heliMission.runaway
      && ['skylark', 'f22', 'a320', 'tpose'].every((id) => PR.profileIn(id, 'mission').escape === PR.profileIn(id, 'free').escape),
    heliMission.escape);
  ok('the fast jets have rocket seats', ['vanguard', 'f22', 'f35b', 'fa18', 'osprey', 'nightjar', 'massimo'].every((id) => PR.profileFor(id).escape === 'seat'));
  ok('the light aeroplanes bail out of the door', ['skylark', 'courier', 'tempest'].every((id) => PR.profileFor(id).escape === 'bail'));
  ok('T-Pose Harrison opens his own parachute, and nothing flies on without him (he IS the aeroplane)',
    PR.profileFor('tpose').escape === 'jump' && PR.profileFor('tpose').ends && !PR.profileFor('massimo').ends);
  ok('passengers first: the Nightjar B-2 and the Osprey carry crew with seats of their own',
    PR.profileFor('nightjar').crew >= 1 && PR.profileFor('osprey').crew >= 1 && PR.profileFor('f22').crew === 0);
  ok('self-destruct on the special planes only — and never on a person (T-Pose Harrison)', ['nightjar', 'f22', 'f35b', 'massimo'].every((id) => PR.profileFor(id).selfDestruct)
    && ['skylark', 'a320', 'harrier', 'fa18', 'vanguard', 'tpose'].every((id) => !PR.profileFor(id).selfDestruct), PR.listed('selfDestruct').join(', '));
  {
    const withChute = AIRCRAFT.filter((t) => PR.profileFor(t).dragChute).map((t) => t.id).sort();
    ok('drag chutes only on the goofy planes: Air Massimo and T-Pose Harrison', withChute.join(',') === 'massimo,tpose'
      && PR.listed('dragChute').sort().join(',') === 'massimo,tpose', withChute.join(', '));
    ok('no drag chute on the real military jets: the F-22, the Vanguard and the Nightjar B-2 (nor the F-35B, F/A-18, Osprey)',
      ['f22', 'vanguard', 'nightjar', 'f35b', 'fa18', 'osprey'].every((id) => !PR.profileFor(id).dragChute));
  }
  ok('uniforms based on planes: captain, fighter, heli, casual, racer, Harrison',
    PR.profileFor('b747').uniform === 'captain' && PR.profileFor('f35b').uniform === 'fighter' && PR.profileFor('harrier').uniform === 'heli'
      && PR.profileFor('skylark').uniform === 'casual' && PR.profileFor('massimo').uniform === 'racer' && PR.profileFor('tpose').uniform === 'harrison');
  ok('an aeroplane nobody listed still gets a sensible answer', PR.profileFor({ id: 'x', class: 'Jumbo airliner' }).escape === 'none'
    && PR.profileFor({ id: 'y', military: true }).escape === 'seat'
    && PR.profileIn({ id: 'z', shape: { power: { kind: 'prop', rotor: true } } }, 'free').bailFrom === heliFree.bailFrom
    && PR.profileIn({ id: 'z', shape: { power: { kind: 'prop', rotor: true } } }, 'mission').escape === 'none');
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
  let openAgl = null;
  let t = 0;
  const inp = input || { turn: 0, sink: false };
  for (; t < seconds && !f.landed; t += 1 / 60) {
    const was = -f.vel.y;
    const landed = f.step(1 / 60, inp, new THREE.Vector3(0, 0, 0), ground);
    if (f.open >= 1) maxOpenSink = Math.max(maxOpenSink, -f.vel.y);
    if (f.open >= 1 && openAgl === null) openAgl = f.pos.y - ground;
    if (landed) landSink = was;
  }
  return { f, t, landSink, maxOpenSink, openAgl, dist: Math.hypot(f.pos.x, f.pos.z) };
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
  const heliDoor = PR.profileIn('harrier', 'free').bailFrom;
  const hover = drop({ kind: 'bail', agl: heliDoor, speed: 0 });
  ok(`out of a HOVERING helicopter's door at its ${heliDoor} m: the canopy is full well before the ground, a gentle landing`,
    hover.f.landed && hover.openAgl > 40 && hover.landSink < 5.5,
    `full at ${hover.openAgl === null ? 'never' : hover.openAgl.toFixed(0) + ' m'}, ${hover.landSink.toFixed(1)} m/s at touchdown`);
  const sink =drop({ agl: 600, speed: 60, input: { turn: 0, sink: true } });
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
/**
 * fighters.mjs's landing, braking hard from touchdown. `press`: seconds after
 * touchdown the pilot pulls the drag chute (null or false: never). Whether it
 * comes out is dragchute.js's own rule (chuteBlocker), as in the game — the
 * brakes are held the whole roll and are not part of that rule.
 */
function land(id, press = null, mode = 'simplified') {
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
  let state = 'stowed';
  let tdT = null;
  let pressed = null; // what the press got: null (out) or chuteBlocker's reason
  let tdKt = 0;
  const has = PR.profileFor(id).dragChute;
  ac.on(P.EVENTS.TOUCHDOWN, (g) => { if (!td) { td = g; tdX = ac.pos.x; tdKt = ac.groundSpeed * KT; } });
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
    if (td && tdT === null) tdT = t;
    // The pilot pulls it (once), and it comes out only if the rule says so.
    if (press !== null && press !== false && tdT !== null && pressed === null && t - tdT >= press) {
      pressed = DC.chuteBlocker({ has, onGround: ac.onGround, crashed: ac.crashed, groundSpeed: ac.groundSpeed, throttle: ac.controls.throttle, state }) || 'out';
      if (pressed === 'out') {
        state = 'out';
        popped = true;
      }
    }
    if (state === 'out') {
      if (ac.groundSpeed > DC.DRAG_CHUTE.CUT_BELOW && ac.onGround) {
        fill = Math.min(1, fill + STEP / DC.DRAG_CHUTE.FILL);
        peak = Math.max(peak, DC.applyChute(ac, mass, fill, STEP));
      } else state = 'cut';
    }
    if (td && ac.groundSpeed < 2.5 && ac.groundTime > 1.2) {
      stop = ac.pos.x;
      break;
    }
  }
  return { crashed: ac.crashed, reason: ac.crashReason, roll: stop !== null && tdX !== null ? stop - tdX : null, stop, popped, pressed, tdKt, peakG: peak / 9.81 };
}
/*
 * The numbers the owner asked for: each goofy plane landed twice, braking
 * hard the whole roll — once never touching the chute, once pulling it half a
 * second after the wheels touch (a child's reaction). Braking alone it never
 * comes out; pulled, it takes a third or more off the roll.
 */
const ROLLS = {};
for (const id of ['massimo', 'tpose']) {
  const a = land(id, null);
  const b = land(id, 0.5);
  ROLLS[id] = { alone: a, chute: b };
  ok(`${id}: braking alone (Space the whole roll), the chute never comes out by itself`, !a.crashed && !a.popped && a.roll > 0,
    `${Math.round(a.roll)} m from touchdown at ${Math.round(a.tdKt)} kt to a stop, no chute`);
  const cut = a.roll && b.roll ? 1 - b.roll / a.roll : 0;
  ok(`${id}: pulled half a second after touchdown, the drag chute really shortens the landing roll (by a third or more)`,
    !b.crashed && b.popped && b.pressed === 'out' && b.roll > 0 && cut >= 0.33 && b.stop < 550,
    `${Math.round(a.roll)} m braking alone, ${Math.round(b.roll)} m with the chute (${Math.round(cut * 100)}% shorter, up to ${b.peakG.toFixed(2)} g from the chute), stopped at x ${Math.round(b.stop)} of 550`);
}
for (const id of ['f22', 'vanguard', 'nightjar']) {
  const a = land(id, null);
  const b = land(id, 0.5);
  ok(`${id}: no drag chute — pulling it does nothing (the roll is the brakes' alone) and it says why`,
    !a.crashed && !b.crashed && !b.popped && b.pressed === 'none' && Math.abs(b.roll - a.roll) < 1 && /only Air Massimo and T-Pose Harrison/.test(DC.chuteWords(b.pressed)),
    `${Math.round(a.roll)} m on the brakes, touchdown at ${Math.round(a.tdKt)} kt, stopped at x ${Math.round(a.stop)}`);
}
{
  const roll = { has: true, onGround: true, crashed: false, groundSpeed: 70 / KT, throttle: 0, state: 'stowed' };
  const B = DC.chuteBlocker;
  ok('the rule: on the landing roll above 40 kt, power back, packed — it comes out; the brakes are not part of it',
    B(roll) === null && B({ ...roll, brakes: 1 }) === null && B({ ...roll, brakes: 0 }) === null && DC.chuteBlocker.length === 1);
  ok('the rule: not in the air, not too slow, not under power, not twice, not on a plane without one',
    B({ ...roll, onGround: false }) === 'air' && B({ ...roll, groundSpeed: 30 / KT }) === 'slow' && B({ ...roll, throttle: 0.8 }) === 'power'
      && B({ ...roll, state: 'used' }) === 'used' && B({ ...roll, state: 'cut' }) === 'used' && B({ ...roll, state: 'out' }) === 'out'
      && B({ ...roll, has: false }) === 'none' && B({ ...roll, crashed: true }) === 'crashed');
  ok('the words: kind, short, and name the key when there is one',
    /touch down first, then press <kbd>;<\/kbd>/.test(DC.chuteWords('air', '<kbd>;</kbd>')) && !/press/.test(DC.chuteWords('air', ''))
      && /idle/.test(DC.chuteWords('power')) && /slow/i.test(DC.chuteWords('slow')) && DC.chuteWords('out') === '' && DC.chuteWords('crashed') === '');
  const IN = await import(SRC + 'flight/input.js');
  const free = Object.keys(IN.ACTIONS).filter((k) => k !== 'dragChute' && IN.ACTIONS[k].default.includes('Semicolon'));
  ok('the key: a named action, "Drag chute", on ; (free), shown as ; and movable in Settings',
    IN.ACTIONS.dragChute && IN.ACTIONS.dragChute.default.join() === DC.CHUTE_DEFAULT_KEY && DC.CHUTE_DEFAULT_KEY === 'Semicolon' && free.length === 0
      && IN.keyLabel('Semicolon') === ';' && IN.defaultBindings().dragChute.join() === 'Semicolon', IN.ACTIONS.dragChute && IN.ACTIONS.dragChute.label);
}
ok('the drag chute pulls harder the faster you go, and nothing at a stop', DC.chuteDecel(40, 5200) > DC.chuteDecel(20, 5200) * 3.9 && DC.chuteDecel(0, 5200) === 0);

/* ------------------------------------------------------ T-Pose Harrison --- */
const STALL = {};
/** The box round what is DRAWN of `obj` (hidden parts left out), exact to the vertex. */
function visibleBox(obj) {
  const box = new THREE.Box3();
  const one = new THREE.Box3();
  let top = obj;
  while (top.parent) top = top.parent;
  top.updateMatrixWorld(true);
  obj.traverse((o) => {
    if (!o.isMesh) return;
    for (let q = o; q; q = q.parent) if (!q.visible) return;
    one.makeEmpty();
    one.expandByObject(o, true);
    box.union(one);
  });
  return box;
}
function harrisonModelChecks(t) {
  const H = HM;
  const s = t.shape.scale;
  const W0 = new Weather();
  W0.windSpeedKts = 0;
  // Parked, as the flight model rests him.
  P.applyAircraft('tpose');
  const pa = new P.Aircraft();
  pa.reset({ pos: new THREE.Vector3(-530, 0, 0), headingDeg: 90, engineOn: true });
  for (let i = 0; i < 480; i++) pa.update(STEP, W0);
  const model = createAircraftModel({ type: t });
  const acView = (o = {}) => ({ controls: { throttle: 0, roll: 0, pitch: 0, yaw: 0, ...(o.controls || {}) }, rpm: 0.2, engineOn: true, gearPos: 1, flaps: 0,
    onGround: true, groundSpeed: 0, agl: pa.agl, pos: pa.pos, vel: pa.vel, quat: pa.quat, ...o });
  model.position.copy(pa.pos);
  model.quaternion.copy(pa.quat);
  // No board, no wheels, no rocket, no flame: a man, and his hands.
  const bad = [];
  let meshes = 0;
  model.traverse((o) => {
    if (!o.isMesh) return;
    if (/board|wheel|tyre|rocket|flame|nozzle|deck|fin\b/i.test(o.name)) bad.push(o.name);
    for (let q = o; q; q = q.parent) if (!q.visible) return;
    meshes++;
  });
  ok('Harrison: no hoverboard, no wheels, no rocket and no flame drawn — just him', bad.length === 0 && meshes <= 13,
    `${meshes} meshes drawn${bad.length ? ', ' + bad.join(', ') : ''}`);
  // Over a whole bob: the lowest drawn point of him above the ground.
  const ground = heightAtFn(pa.pos.x, pa.pos.z);
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < 160; i++) {
    model.userData.update(1 / 60, acView(), {});
    const box = visibleBox(model);
    const gap = box.min.y - ground;
    lo = Math.min(lo, gap);
    hi = Math.max(hi, gap);
  }
  ok('Harrison floats: parked, every part of him clears the ground, by the gap he is built to hover at, bobbing gently',
    lo > 0.12 && Math.abs((lo + hi) / 2 - H.HOVER_GAP) < 0.05 && hi - lo > 0.02 && hi - lo < 0.08,
    `${lo.toFixed(3)}..${hi.toFixed(3)} m clear (built for ${H.HOVER_GAP} m), centre of gravity ${pa.agl.toFixed(2)} m up`);
  ok('Harrison hovers level on the ground, as he always sat', Math.abs(pa.bankAngleDeg()) < 0.5 && Math.abs(pa.pitchAngleDeg()) < 2 && pa.contactCount === 3,
    `pitch ${pa.pitchAngleDeg().toFixed(2)}°, bank ${pa.bankAngleDeg().toFixed(2)}°, on ${pa.contactCount} invisible contacts`);
  // Head-first: the head is the nose, the hands are the wing tips.
  model.position.set(0, 0, 0);
  model.quaternion.identity();
  for (let i = 0; i < 60; i++) model.userData.update(1 / 60, acView({ onGround: false, agl: 500 }), {});
  const all = visibleBox(model.userData.rider);
  const rig = model.userData.person.userData.rig;
  const headBox = visibleBox(rig.head);
  const eyes = new THREE.Vector3(0, 0.02, -0.138);
  rig.head.localToWorld(eyes);
  const eye = t.shape.eye.map((v) => v * s);
  const tips = rig.arms.map((a) => a.wrist.localToWorld(new THREE.Vector3(0, -0.15, 0)));
  const plan = t.plan;
  ok('Harrison: head-first along the flight path — his head is the nose, his feet the tail, his arms the span',
    Math.abs(headBox.min.z - all.min.z) < 0.02 && all.max.z > 2 && all.max.x - all.min.x > 3.3 && Math.abs(all.max.y - all.min.y) < 1.1
      && Math.abs(all.min.z - plan.nose) < 0.03 && Math.abs(all.max.z - plan.tail) < 0.03 && Math.abs((all.max.x - all.min.x) - plan.span) < 0.03,
    `nose (head) z ${all.min.z.toFixed(2)}, tail (toes) z ${all.max.z.toFixed(2)}, span ${(all.max.x - all.min.x).toFixed(2)} m, depth ${(all.max.y - all.min.y).toFixed(2)} m`);
  ok('Harrison: the cockpit is his eyes, and the wing tips are his fingertips (where the flight model strikes them)',
    Math.hypot(eyes.x - eye[0], eyes.y - eye[1], eyes.z - eye[2]) < 0.03
      && tips.every((p) => Math.abs(Math.abs(p.x) - specFor('tpose').hardPoints[2].pos.x) < 0.04 && Math.abs(p.y - specFor('tpose').hardPoints[2].pos.y) < 0.06),
    `eyes ${eyes.toArray().map((v) => v.toFixed(2))} vs eye point ${eye.map((v) => v.toFixed(2))}; fingertips x ±${Math.abs(tips[1].x).toFixed(2)} y ${tips[1].y.toFixed(2)} vs tip strike ${specFor('tpose').hardPoints[2].pos.x.toFixed(2)}, ${specFor('tpose').hardPoints[2].pos.y.toFixed(2)}`);
  // The arms follow the flaps.
  const settle = (o, secs) => {
    let a = model.userData.arms.right;
    let mn = Infinity;
    let mx = -Infinity;
    for (let i = 0; i < secs * 60; i++) {
      model.userData.update(1 / 60, acView(o), {});
      a = model.userData.arms.right;
      if (i > secs * 30) {
        mn = Math.min(mn, a.droop);
        mx = Math.max(mx, a.droop);
      }
    }
    return { ...a, min: mn, max: mx, range: mx - mn };
  };
  const air = (f) => ({ onGround: false, agl: 500, flaps: f });
  const up0 = settle(air(0), 4);
  ok('flap arms: flaps up, dead-straight T arms — shoulder, elbow and wrist all exactly straight',
    Math.abs(up0.droop) < 1e-3 && Math.abs(up0.elbow) < 1e-3 && Math.abs(up0.wrist) < 1e-3 && up0.range < 1e-3,
    `shoulder ${up0.droop.toFixed(4)}, elbow ${up0.elbow.toFixed(4)}, wrist ${up0.wrist.toFixed(4)} rad`);
  // The lever moving: a beat.
  let beat = 0;
  let lo2 = Infinity;
  let hi2 = -Infinity;
  for (let i = 0; i < 60; i++) {
    model.userData.update(1 / 60, acView(air((i / 60) / 3)), {});
    lo2 = Math.min(lo2, model.userData.arms.right.droop);
    hi2 = Math.max(hi2, model.userData.arms.right.droop);
    beat = Math.max(beat, Math.abs(model.userData.arms.right.elbow));
  }
  ok('flap arms: running the flaps out is a visible wing-beat, the elbow following through', hi2 - lo2 > 0.35 && beat > 0.05,
    `shoulder swept ${(hi2 - lo2).toFixed(2)} rad in the notch's one second, elbow lag up to ${beat.toFixed(2)} rad`);
  const rows = [];
  let mono = true;
  let prev = -1;
  for (const f of [1 / 3, 2 / 3, 1]) {
    const g = settle({ onGround: true, agl: 2.5, flaps: f }, 5); // on the ground: the rest pose, no rhythm
    const a2 = settle(air(f), 4);
    rows.push(`${Math.round(f * 3)}: rest ${g.droop.toFixed(2)}/${g.elbow.toFixed(2)}/${g.wrist.toFixed(2)}, flapping ${a2.min.toFixed(2)}..${a2.max.toFixed(2)}`);
    if (!(g.droop > prev + 0.05) || !(g.range < 0.01) || !(a2.range > 0.15) || !(g.elbow > 0) || !(g.wrist > 0)) mono = false;
    prev = g.droop;
  }
  ok('flap arms: each notch cups them further (shoulder down and forward, elbow and wrist curling the tips under), and in the air with flaps out he keeps up a steady flap',
    mono, rows.join(' · '));
  const gnd = settle({ onGround: true, agl: pa.agl, flaps: 1 }, 3);
  model.userData.update(1 / 60, acView({ flaps: 1 }), {});
  model.position.copy(pa.pos);
  model.quaternion.copy(pa.quat);
  const handLow = Math.min(...rig.arms.map((a) => visibleBox(a.arm).min.y)) - ground;
  model.position.set(0, 0, 0);
  model.quaternion.identity();
  ok('flap arms: parked with full flap his hands stay off the ground', handLow > 0.04, `lowest hand ${handLow.toFixed(2)} m up, shoulder ${gnd.droop.toFixed(2)} rad`);
  // The spin: on the pattern, drill-like; off it, it winds down belly-down.
  const M = SIG;
  const sigC = { pitch: M.SIGNAL.pitch, roll: M.SIGNAL.roll, yaw: M.SIGNAL.yaw };
  const spinState = () => model.userData.spin();
  for (let i = 0; i < 180; i++) model.userData.update(1 / 60, acView({ onGround: false, agl: 500, controls: sigC }), {});
  const sp = spinState();
  const armsOut = { ...model.userData.arms.right };
  for (let i = 0; i < 240; i++) model.userData.update(1 / 60, acView({ onGround: false, agl: 500 }), {});
  const after = spinState();
  let fake = 0;
  for (let i = 0; i < 120; i++) {
    model.userData.update(1 / 60, acView({ onGround: false, agl: 500, controls: { pitch: Math.sin(i) * 0.25, roll: 0.75, yaw: -0.75 } }), {});
    fake = Math.max(fake, spinState().rate);
  }
  ok('spin: on the spin pattern his body spins round its own axis like a drill, 1.5 turns a second, arms dead straight out; off it, he winds down belly-down; a stick that only nearly matches never spins him',
    Math.abs(sp.rate / (Math.PI * 2) - M.SPIN_TURNS) < 0.05 && sp.on && Math.abs(armsOut.droop) < 0.02 && after.rate === 0 && after.angle === 0 && fake === 0,
    `${(sp.rate / (Math.PI * 2)).toFixed(2)} turns/s, arms ${armsOut.droop.toFixed(3)} rad; 4 s later ${after.rate.toFixed(2)} rad/s at ${after.angle.toFixed(2)} rad; near-miss pattern ${fake.toFixed(2)} rad/s`);
  // The cones come with Mach 1.
  const cones = (kt, alt = 300) => {
    const v = new THREE.Vector3(kt / KT, 0, 0);
    const pos = new THREE.Vector3(0, alt, 0);
    for (let i = 0; i < 4; i++) model.userData.update(1 / 60, acView({ onGround: false, agl: alt, vel: v, pos }), {});
    return { vap: model.getObjectByName('vapourCone').visible, shock: model.getObjectByName('shockCone').visible };
  };
  const c500 = cones(500);
  const c660 = cones(660); // about Mach 1 low down
  const c1000 = cones(1000);
  ok('boost: a vapour cone round him through the sound barrier, a shock cone past it, nothing at 500 kt',
    !c500.vap && !c500.shock && c660.vap && c1000.shock && !c1000.vap, JSON.stringify({ c500, c660, c1000 }));
  // Out of him: nothing left to draw.
  model.userData.setRider(false);
  let shown = 0;
  model.traverse((o) => {
    if (!o.isMesh) return;
    for (let q = o; q; q = q.parent) if (!q.visible) return;
    shown++;
  });
  model.userData.setRider(true);
  ok('Harrison: out of him there is nothing left to draw (he is the whole aeroplane)', shown === 0, `${shown} meshes showing`);
}
{
  const t = getAircraft('tpose');
  ok('T-Pose Harrison is in the roster: a special, not military, with his own name, card words and model', t.id === 'tpose' && t.name === 'T-Pose Harrison'
    && t.category === 'special' && !t.military && /T-pose/i.test(t.blurb) && typeof t.buildModel === 'function');
  harrisonModelChecks(t);
  const W = new Weather();
  W.windSpeedKts = 0;
  // Stands still.
  P.applyAircraft('tpose');
  let ac = new P.Aircraft();
  ac.reset({ pos: new THREE.Vector3(-530, 0, 0), headingDeg: 90, engineOn: true });
  for (let i = 0; i < 360 && !ac.crashed; i++) ac.update(STEP, W);
  ok('Harrison rests on his three (invisible) contacts when spawned', !ac.crashed && ac.contactCount === 3 && Math.abs(ac.bankAngleDeg()) < 0.5, `pitch ${ac.pitchAngleDeg().toFixed(2)}°`);
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
  // Stalling speed, flown: level at 1,000 m, power off, the nose held up
  // until the stall warning — clean, and with his arms (the flaps) out.
  // The slowest he can hold his height, power off — the stall warning, or
  // the wing giving up (sinking away with the stick fully back), whichever
  // comes first: his stalling speed as a pilot meets it.
  const stallKt = (notch) => {
    P.applyAircraft('tpose');
    const a = new P.Aircraft();
    a.mode = 'realistic';
    a.reset({ pos: new THREE.Vector3(0, 0, 0), headingDeg: 90, engineOn: true, gearDown: false, speed: 95, altAGL: 1000 });
    a.setFlaps(notch);
    a.flaps = notch / 3;
    a.stopEngine('shutdown'); // a glide: his idle push alone holds him fast and clean
    let ias = null;
    const y0 = a.pos.y;
    let slow = Infinity;
    for (let tt = 0; tt < 180 && !a.crashed; tt += STEP) {
      a.controls.throttle = 0;
      a.controls.roll = clamp(-a.bankAngleDeg() / 20, -0.5, 0.5);
      a.controls.pitch = clamp((y0 - a.pos.y) * 0.05 - a.vs * 0.25 - a.omega.x * 0.6, -1, 1);
      a.update(STEP, W);
      if (y0 - a.pos.y < 8) slow = Math.min(slow, a.ias * KT);
      if (a.stalled || y0 - a.pos.y > 40) {
        ias = Math.min(slow, a.ias * KT);
        break;
      }
    }
    return ias;
  };
  const perf = performanceFor('tpose');
  const clean = stallKt(0);
  const full = stallKt(3);
  STALL.clean = clean;
  STALL.full = full;
  ok('Harrison\'s flaps (his arms) really lower his stalling speed, flown: clean against full flap',
    clean > 0 && full > 0 && full < clean * 0.9,
    `stalls at ${clean ? clean.toFixed(0) : '—'} kt clean, ${full ? full.toFixed(0) : '—'} kt with full flap (the type's table: ${perf.stallClean} and ${perf.stallLanding} kt)`);
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

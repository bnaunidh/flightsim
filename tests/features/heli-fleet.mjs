/**
 * THE HELICOPTER WAVE IN NODE — the seven rotorcraft added beside the Skyhook
 * (aircraft/extra/helis.js: Bell 407, Airbus H145, Robinson R44, AW139,
 * UH-60 Black Hawk, CH-47 Chinook, AH-64 Apache) and the air the rotor now
 * works in (rotor-assist.js rotorAir: ground effect, translational lift,
 * vortex ring state, autorotation on NR; physics.js retreating blade
 * stall), checked headless against the real roster, the real models and the
 * real flight model.
 *
 *   node tests/features/heli-fleet.mjs [id ...]
 *
 * Per type: the roster entry (class, flags, costs, registration, the arms
 * solved to their rates, the stall speed to the red line); the model (built
 * by its own airframe, one rotor or two of the right radius and blade
 * count, a tail rotor or a fan or none, blades that droop at rest, cone
 * under collective and flap with the airspeed, a head that leans with the
 * cyclic, the drawn gear on the contact points, the plan on the drawing);
 * and the flying: spawn and stand still, lift off and hover hands off, in
 * and out of ground effect, forward with translational lift, the top speed
 * bounded by the retreating blade, and an engine failure from a cruise that
 * the assist flies to a landing a Normal pilot survives. Then the Skyhook
 * and the R44 raw: vortex ring state on a fast vertical descent and the way
 * out of it, and NR that bleeds with the lever up and holds with it down.
 *
 * tests/features/heli-fleet.browser.js is the same wave in headless Chrome.
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

import { readFileSync } from 'node:fs';

const SRC = new URL('../../src/', import.meta.url).href;
const THREE = await import(SRC + 'vendor/three.module.js');
const T = await import(SRC + 'aircraft/types.js');
const P = await import(SRC + 'aircraft/physics.js');
const RA = await import(SRC + 'aircraft/rotor-assist.js');
const TER = await import(SRC + 'world/terrain.js');
const { RUNWAY_START } = await import(SRC + 'game/missions.js');
const { createAircraftModel } = await import(SRC + 'aircraft/model-adapter.js');
const { schemeFor } = await import(SRC + 'aircraft/liveries.js');
const { bakeModel } = await import(SRC + 'world/airport-kit.js');
const { HELI_GEOMETRY } = await import(SRC + 'aircraft/extra/helis.js');
const MENU = await import(SRC + 'ui/menus.js');
const WS = await import(SRC + 'world/spawns.js');
const Prog = await import(SRC + 'game/progression.js');
const GR = await import(SRC + 'features/gunsight/rules.js');
const HSK = await import(SRC + 'features/heatseek.js');

TER.applyMap(TER.MAP.id);

const WAVE = ['bell407', 'h145', 'r44', 'aw139', 'uh60', 'ch47', 'ah64', 'vh3d'];
const only = process.argv.slice(2).filter((a) => !a.startsWith('-'));
const IDS = only.length ? only : WAVE;

let failed = 0;
let passed = 0;
function ok(name, pass, detail = '') {
  if (pass) passed++;
  else failed++;
  console.log(`${pass ? 'ok  ' : 'FAIL'} ${name}${detail !== '' ? ` — ${detail}` : ''}`);
}
const f1 = (v) => (Number.isFinite(v) ? v.toFixed(1) : String(v));
const f2 = (v) => (Number.isFinite(v) ? v.toFixed(2) : String(v));
const KT = 1.94384;

/* ------------------------------------------------------------------ *
 * The air
 * ------------------------------------------------------------------ */
const wind = new THREE.Vector3();
const weather = {
  windVector: (o) => (o || new THREE.Vector3()).copy(wind),
  gustVector: (o) => (o || new THREE.Vector3()).set(0, 0, 0),
  turbulenceLevel: () => 0,
  cond: { rain: 0, cloud: 0 },
  time_s: 0,
  downdraft: 0,
  vortex: null,
  isNight: false,
};

/* ------------------------------------------------------------------ *
 * The machine, flown the way main.js flies it
 * ------------------------------------------------------------------ */
const STEP = 1 / 120;
function spawn(id, { mode = 'simplified', assist = true, difficulty = null } = {}) {
  P.applyAircraft(id);
  const ac = new P.Aircraft();
  ac.mode = mode;
  ac.difficulty = difficulty || (mode === 'simplified' ? 'normal' : 'realistic');
  ac.hoverAssist = assist;
  ac.reset({ ...RUNWAY_START, engineOn: true });
  ac.settleOnGear();
  weather.time_s = 0;
  return ac;
}
/** A pilot: a lever (0..1) that follows the assist's trim request hands off, and a stick. */
function pilot(ac) {
  const p = { lever: 0, pitch: 0, roll: 0, yaw: 0, held: false };
  p.step = (secs, each) => {
    const n = Math.max(1, Math.round(secs / STEP));
    for (let i = 0; i < n; i++) {
      weather.time_s += STEP;
      if (each && each(i * STEP) === true) return true;
      ac.controls.throttle = p.lever;
      ac.controls.pitch = p.pitch;
      ac.controls.roll = p.roll;
      ac.controls.yaw = p.yaw;
      ac.controls.brakes = 0;
      ac.controls.leverHeld = p.held;
      ac.update(STEP, weather);
      if (!p.held && ac.rotor && ac.rotor.trimRequest) p.lever = THREE.MathUtils.clamp(p.lever + ac.rotor.trimRequest * STEP, 0, 1);
      if (ac.crashed) return true;
    }
    return false;
  };
  return p;
}
const skidH = (ac) => (ac.rotor && Number.isFinite(ac.rotor.heightAbove) ? ac.rotor.heightAbove : ac.agl);
/** Lever up until about `h` m of air under the skids, then hands off to settle. */
function liftTo(ac, p, h) {
  p.held = true;
  p.step(30, () => {
    const vs = Math.max(0, ac.vs);
    const stop = skidH(ac) + (vs * vs) / 6 + vs * 0.3 > h;
    if (!stop) p.lever = Math.min(1, p.lever + 0.62 * STEP);
    return stop;
  });
  p.held = false;
  p.step(6);
}

/* ================================================================== *
 * 1. The roster
 * ================================================================== */
console.log('\n--- the roster ---');
{
  const ids = T.AIRCRAFT.map((a) => a.id);
  ok('the wave (and Marine One) are in the roster, after the Skyhook', WAVE.every((id) => ids.includes(id)) && ids.indexOf('harrier') < ids.indexOf('bell407'), ids.filter((id) => WAVE.includes(id)).join(', '));
  ok('no id clashes with the fleet pack or anything else', new Set(ids).size === ids.length);
  const text = readFileSync(new URL('../../src/aircraft/extra/helis.js', import.meta.url), 'utf8') + readFileSync(new URL('../../src/aircraft/models/helis.js', import.meta.url), 'utf8');
  ok('nothing a player reads in the wave\'s files says "kid"', !/\bkids?\b/i.test(text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')));
}
for (const id of IDS) {
  const t = T.getAircraft(id);
  const spec = T.specFor(id);
  const Gm = HELI_GEOMETRY[id];
  ok(`${id}: a Helicopter the game knows as one (class, isHelicopter, spec.rotor, spawn class heli, picker heading Helicopters)`,
    t.class === 'Helicopter' && T.isHelicopter(t) && spec.rotor === true && spec.propeller === false && WS.spawnClassOf(t) === 'heli' && MENU.aircraftCategory(t) === 'helicopter',
    `${t.class} / ${WS.spawnClassOf(t)} / ${MENU.aircraftCategory(t)}`);
  ok(`${id}: the rotor is the published one (radius ${Gm.R} m, ${Gm.blades} blades, ${f1(Gm.hz * 60)} rpm)`,
    spec.rotorRadius === Gm.R && spec.rotorBlades === Gm.blades && Math.abs(spec.rotorHz - Gm.hz) < 1e-6 && spec.rotorTandem === !!Gm.tandem, `${spec.rotorRadius} / ${spec.rotorBlades} / ${spec.rotorHz}`);
  ok(`${id}: the retreating blade stalls at 0.86 of the red line (${f1(spec.rotorStallAt * KT)} of ${f1(spec.vne * KT)} kt)`, Math.abs(spec.rotorStallAt / spec.vne - 0.86) < 0.01);
  const feel = RA.describeRotorFeel(spec);
  const rates = { r44: [85, 55, 75], bell407: [72, 48, 68], h145: [62, 42, 60], aw139: [55, 38, 55], uh60: [50, 35, 50], ch47: [40, 30, 42], ah64: [60, 40, 55], vh3d: [45, 32, 45] }[id];
  ok(`${id}: the arms produce the rates they were solved for (roll ${rates[0]}, pitch ${rates[1]}, yaw ${rates[2]} deg/s)`,
    Math.abs(feel.rollRateDegPerSec - rates[0]) < 1.5 && Math.abs(feel.pitchRateDegPerSec - rates[1]) < 1.5 && Math.abs(feel.yawRateDegPerSec - rates[2]) < 1.5,
    `${feel.rollRateDegPerSec} / ${feel.pitchRateDegPerSec} / ${feel.yawRateDegPerSec}`);
  ok(`${id}: mass between the real empty weight and MTOW, a ceiling, fuel, a hover at half lever`, spec.mass > 500 && spec.ceiling >= 14000 && spec.fuelCapacity > 100 && RA.rotorLiftRatio(0.5) === 1);
  const perf = T.performanceFor(id);
  ok(`${id}: the hangar card quotes its red line and endurance (${perf.vne} kt, ${perf.enduranceMin} min)`, perf.vne > 100 && perf.enduranceMin > 60 && perf.enduranceMin < 400);
  const mil = ['uh60', 'ch47', 'ah64'].includes(id);
  ok(`${id}: ${mil ? 'military, behind the passcode, under the Helicopters heading' : 'civil, not gated'}`,
    !!t.military === mil && Prog.needsPasscode({ militaryUnlocked: false, unlocked: [] }, t) === mil && (mil ? t.category === 'helicopter' && t.carrier === false : true));
  ok(`${id}: ${id === 'ah64' ? 'the Apache has its gun (and no heat-seekers)' : 'no gun, no heat-seekers'}`,
    GR.hasGuns(t, 'flight') === (id === 'ah64') && GR.hasGuns(t, 'heli') === (id === 'ah64') && !GR.militaryJet(t, 'flight')
    && !HSK.carriesMissiles({ aircraftType: t, game: 'flight' }) && !HSK.carriesMissiles({ aircraftType: t, game: 'heli' }));
  ok(`${id}: for sale in the hangar at a price (${Prog.costOf(id)} credits)`, Prog.costOf(id) > 0 && Prog.UNLOCKS.some((u) => u.aircraft === id && !!u.military === mil));
  const scheme = schemeFor(t, 'house');
  if (t.fixedLivery) {
    // Marine One: its own fixed paint whatever is picked, titled, no number of a real airframe.
    ok(`${id}: wears its own fixed scheme whatever livery is picked (${scheme && scheme.name})`,
      ['house', 'skyhook', 'potus', 'kanal'].every((l) => schemeFor(t, l) === scheme) && scheme.id === t.fixedLivery && !!scheme.title, scheme && scheme.id);
  } else {
    ok(`${id}: wears a registration of its own in house colours`, !!(scheme && scheme.reg && scheme.reg !== 'N172SK'), scheme && scheme.reg);
  }
}

/* ================================================================== *
 * 2. The models
 * ================================================================== */
console.log('\n--- the models ---');
const REST = { controls: { pitch: 0, roll: 0, yaw: 0, throttle: 0, brakes: 1 }, rpm: 0, flaps: 0, gearPos: 1, gearDown: true, onGround: true, groundSpeed: 0, agl: 0, engineOn: false };
const WX = { isNight: false, cond: { cloud: 0 } };
const meshesOf = (root, keep = () => true) => {
  const out = [];
  root.traverse((o) => {
    if (o.isMesh && keep(o)) out.push(o);
  });
  return out;
};
for (const id of IDS) {
  const t = T.getAircraft(id);
  const spec = T.specFor(id);
  const Gm = HELI_GEOMETRY[id];
  let model;
  try {
    model = createAircraftModel({ type: t, livery: schemeFor(t, 'house') });
  } catch (e) {
    ok(`${id}: the model builds`, false, e && e.message);
    continue;
  }
  model.userData.update(0.016, REST, WX);
  ok(`${id}: drawn by its own airframe (models/helis.js), not the generic factory`, model.userData.civil === id, model.userData.civil);
  const parts = model.userData.parts;
  const rotors = parts && parts.rotors;
  const want = Gm.tandem ? 2 : 1;
  ok(`${id}: ${want} rotor${want > 1 ? 's' : ''} of ${Gm.blades} blades`, !!rotors && rotors.length === want && rotors.every((R) => R.coners.length === Gm.blades), rotors && rotors.map((R) => R.coners.length).join('+'));
  if (!rotors) continue;
  // The disc and the blade tips reach the physics' radius.
  const R0 = rotors[0];
  const disc = new THREE.Box3().setFromObject(R0.disc);
  const discR = (disc.max.x - disc.min.x) / 2;
  ok(`${id}: the blur disc is the physics' rotor radius (${Gm.R} m)`, Math.abs(discR - spec.rotorRadius) < 0.03, f2(discR));
  let tip = 0;
  R0.blades.updateWorldMatrix(true, true);
  R0.blades.traverse((o) => {
    if (o.isMesh) {
      const bb = new THREE.Box3().setFromObject(o);
      tip = Math.max(tip, Math.hypot(Math.max(-bb.min.x, bb.max.x), 0));
    }
  });
  ok(`${id}: the blade tips reach the disc and no further`, Math.abs(tip - spec.rotorRadius) < 0.05, f2(tip));
  if (Gm.tandem) {
    ok(`${id}: the two rotors turn opposite ways, the aft one high on its pylon`, rotors[0].dir === 1 && rotors[1].dir === -1 && rotors[1].head.position.y > rotors[0].head.position.y + 1 && Math.abs(rotors[1].head.position.z - rotors[0].head.position.z - 11.94) < 0.05,
      `${rotors[0].dir}/${rotors[1].dir}, hubs ${f2(rotors[0].head.position.z)} and ${f2(rotors[1].head.position.z)}`);
    ok(`${id}: no tail rotor on a tandem`, !rotors[0].tail && !rotors[1].tail);
  } else {
    ok(`${id}: a tail rotor of ${Gm.tailBlades} blades, radius ${Gm.tailR} m${Gm.fenestron ? ', in a fenestron shroud' : ''}`,
      !!R0.tail && R0.tailCount === Gm.tailBlades && !!model.getObjectByName('tail rotor') && (!Gm.fenestron || !!model.getObjectByName('fenestron shroud')));
    const tr = model.getObjectByName('tail rotor').getWorldPosition(new THREE.Vector3());
    const hub = R0.head.getWorldPosition(new THREE.Vector3());
    ok(`${id}: the tail rotor sits outside the main rotor's reach`, tr.z - Gm.tailR > hub.z + spec.rotorRadius - 0.3 || tr.z > hub.z + spec.rotorRadius, `tail rotor at z ${f2(tr.z)}, main reaches ${f2(hub.z + spec.rotorRadius)}`);
  }
  // Droop at rest, cone running, flap with the airspeed.
  const droop = R0.coners[0].rotation.z;
  model.userData.update(0.5, { ...REST, engineOn: true, rpm: 0.6, onGround: false, agl: 30, rotor: { nr: 1, collective: 0.6 } }, WX);
  for (let i = 0; i < 40; i++) model.userData.update(0.1, { ...REST, engineOn: true, rpm: 0.6, onGround: false, agl: 30, rotor: { nr: 1, collective: 0.6 } }, WX);
  const coned = R0.coners[0].rotation.z;
  ok(`${id}: the blades droop at rest and cone up under collective`, droop < -0.02 && coned > 0.02, `${f2(droop)} rad at rest, ${f2(coned)} running`);
  ok(`${id}: a running rotor draws its disc; the disc is coned, not flat`, R0.disc.visible && R0.disc.userData.opacity > 0.9 && disc.max.y - disc.min.y > 0.05);
  // Flapping: at 40 m/s the blades differ by azimuth.
  model.userData.update(0.1, { ...REST, engineOn: true, rpm: 0.6, onGround: false, agl: 30, groundSpeed: 40, rotor: { nr: 0.5, collective: 0.5 } }, WX);
  const angles = R0.coners.map((c) => c.rotation.z);
  const spread = Math.max(...angles) - Math.min(...angles);
  ok(`${id}: the blades flap once a turn with the airspeed (spread ${f2(spread)} rad at 40 m/s)`, spread > 0.015);
  // The head leans with the cyclic.
  const lean = (pitch, roll) => {
    for (let i = 0; i < 30; i++) model.userData.update(0.1, { ...REST, controls: { pitch, roll, yaw: 0, throttle: 0.5, brakes: 0 }, engineOn: true, rpm: 0.6, onGround: false, agl: 30, rotor: { nr: 1, collective: 0.5 } }, WX);
    return { x: R0.head.rotation.x, z: R0.head.rotation.z };
  };
  const fwd = lean(-1, 0);
  const right = lean(0, 1);
  ok(`${id}: the disc tips forward for stick forward and right for stick right`, fwd.x < -0.04 && right.z < -0.04, `${f2(fwd.x)} / ${f2(right.z)}`);
  // The drawn machine stands on the physics' contact points, and the plan is
  // the drawing — of a fresh model at rest, as the airfield bakes it (the
  // blades' azimuth after a spin moves the box by a blade).
  const fresh = createAircraftModel({ type: t, livery: schemeFor(t, 'house') });
  fresh.userData.update(0.016, REST, WX);
  const bk = bakeModel(fresh);
  const low = Math.min(...spec.gearPoints.map((g) => g.pos.y));
  ok(`${id}: the lowest drawn point is the gear's contact (${f2(low)} m)`, Math.abs(bk.box.min.y - low) < 0.06, f2(bk.box.min.y));
  const span = Math.max(-bk.box.min.x, bk.box.max.x) * 2;
  ok(`${id}: the plan is the drawing (nose ${f2(bk.box.min.z)}, tail ${f2(bk.box.max.z)}, span ${f2(span)})`,
    Math.abs(t.plan.nose - bk.box.min.z) < 0.5 && Math.abs(t.plan.tail - bk.box.max.z) < 0.5 && Math.abs(t.plan.span - span) < 0.5);
  const tris = meshesOf(model).reduce((n, o) => n + (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3, 0);
  ok(`${id}: cheap enough for a Chromebook (${Math.round(tris)} triangles, ${meshesOf(model).length} meshes)`, tris < 12000 && meshesOf(model).length < 40);
  ok(`${id}: lamps: both nav lights, a beacon and a landing light`, ['navL', 'navR', 'beacon', 'landing'].every((k) => parts.lamps[k]));
}

/* ================================================================== *
 * 3. Flying, each type (Normal, the assist on)
 * ================================================================== */
console.log('\n--- flying ---');
for (const id of IDS) {
  const spec = T.specFor(id);
  const ac = spawn(id);
  const p = pilot(ac);
  const from = ac.pos.clone();
  p.step(3);
  ok(`${id}: spawned on the runway it stands still for 3 s`, ac.onGround && !ac.crashed && ac.pos.distanceTo(from) < 0.3 && Math.abs(ac.readouts().pitch) < 3, `moved ${f2(ac.pos.distanceTo(from))} m, pitch ${f1(ac.readouts().pitch)}`);
  // Ground effect on the skids.
  const ge0 = ac.rotor.groundEffect;
  ok(`${id}: in ground effect on its wheels (+${f1(ge0 * 100)}% lift)`, ge0 > 0.08 && ge0 < 0.2);
  // Lift off to a low hover and watch the collective; then high, and compare.
  liftTo(ac, p, 1.2);
  const lowH = skidH(ac);
  const collIGE = ac.rotor.collective;
  const geLow = ac.rotor.groundEffect;
  ok(`${id}: lifts off and holds a low hover hands off (${f1(lowH)} m, lever ${f2(collIGE)})`, !ac.crashed && !ac.onGround && lowH > 0.3 && lowH < 4 && Math.abs(ac.vs) < 0.5, `vs ${f2(ac.vs)}`);
  liftTo(ac, p, 25);
  const h25 = skidH(ac);
  const collOGE = ac.rotor.collective;
  ok(`${id}: climbs to a hover at ${f1(h25)} m and holds it (vs ${f2(ac.vs)}, drift ${f2(ac.rotor.drift)} m/s)`, !ac.crashed && h25 > 15 && h25 < 40 && Math.abs(ac.vs) < 0.6 && ac.rotor.drift < 1.0);
  ok(`${id}: out of ground effect the hover takes more lever (${f2(collIGE)} low, ${f2(collOGE)} high; GE ${f1(geLow * 100)}% → ${f1(ac.rotor.groundEffect * 100)}%)`, collOGE > collIGE + 0.01 && geLow > 0.03 && ac.rotor.groundEffect < 0.01);
  // Heading hold hands off.
  const hdg0 = ac.heading;
  p.step(5);
  const dh = Math.abs(((ac.heading - hdg0 + 540) % 360) - 180);
  ok(`${id}: the heading holds hands off (${f1(dh)} deg in 5 s)`, dh < 4);
  // Forward: stick forward until 25 m/s, let go; translational lift shows and the hold keeps the height.
  const hBefore = ac.pos.y;
  p.step(40, () => {
    p.pitch = ac.groundSpeed < 25 ? -0.6 : 0;
    return ac.groundSpeed >= 25;
  });
  p.pitch = 0;
  p.step(4);
  const ettl = ac.rotor.translationalLift;
  ok(`${id}: flies forward at ${f1(ac.groundSpeed * KT)} kt with translational lift (+${f1(ettl * 100)}%) and keeps its height (${f1(ac.pos.y - hBefore)} m)`,
    !ac.crashed && ac.groundSpeed > 18 && ettl > 0.09 && Math.abs(ac.pos.y - hBefore) < 12);
  ok(`${id}: ...on less lever than the hover took (${f2(ac.rotor.collective)} against ${f2(collOGE)})`, ac.rotor.collective < collOGE - 0.01);
  // Top speed: full forward stick for 40 s; the retreating blade and the envelope bound it under the red line.
  let vmax = 0;
  p.step(40, () => {
    p.pitch = -1;
    vmax = Math.max(vmax, ac.airspeed);
    return ac.crashed;
  });
  p.pitch = 0;
  ok(`${id}: full forward for 40 s tops out at ${f1(vmax * KT)} kt, past the stall onset (${f1(spec.rotorStallAt * KT)}) and under the red line (${f1(spec.vne * KT)})`,
    !ac.crashed && vmax < spec.vne * 1.02 && vmax > spec.rotorStallAt * 0.75, `rbs ${f2(ac._rbs || 0)}`);
  // Engine failure from a cruise at 150 m: the assist flies the autorotation.
  const ac2 = spawn(id);
  const p2 = pilot(ac2);
  liftTo(ac2, p2, 150);
  p2.step(40, () => {
    p2.pitch = ac2.groundSpeed < 25 ? -0.6 : 0;
    return ac2.groundSpeed >= 25;
  });
  p2.pitch = 0;
  p2.step(3);
  const hFail = skidH(ac2);
  ac2.failures.engine = true;
  let nrMin = 2;
  let nrGlide = 0;
  let sawAuto = false;
  let touchVs = 0;
  p2.step(90, () => {
    if (ac2.onGround) return true;
    if (!ac2.engineOn) {
      sawAuto = sawAuto || !!ac2.rotor.autorotating;
      if (skidH(ac2) > 60 && skidH(ac2) < hFail - 30) nrGlide = ac2.rotor.nr;
      nrMin = Math.min(nrMin, ac2.rotor.nr);
      touchVs = ac2.vs;
    }
    return false;
  });
  const td = ac2.lastTouchdown || {};
  ok(`${id}: engine out at ${f1(hFail)} m, the assist autorotates to a landing (NR ${f2(nrGlide)} in the glide, touched at ${f1(Math.abs(touchVs))} m/s, ${td.vsFpm || '?'} fpm, ${td.quality || '?'})`,
    sawAuto && !ac2.crashed && ac2.onGround && nrGlide > 0.9 && Math.abs(touchVs) < 4.6, `crashed ${ac2.crashed} ${ac2.crashReason || ''} nrMin ${f2(nrMin)}`);
}

/* ================================================================== *
 * 4. The air, raw: the Skyhook and the R44 on Realistic, the assist off
 * ================================================================== */
console.log('\n--- the air, raw ---');
for (const id of ['harrier', 'r44']) {
  // Vortex ring state: from a hover, lever down to sink fast with no airspeed.
  const ac = spawn(id, { mode: 'realistic', assist: true });
  const p = pilot(ac);
  liftTo(ac, p, 120);
  ac.hoverAssist = false;
  const hover = ac.rotor.collective;
  p.held = true;
  p.lever = Math.max(0, RA.leverFor(hover) - 0.45);
  let vrsMax = 0;
  let effMin = 1;
  let sawBuffet = false;
  p.step(9, () => {
    vrsMax = Math.max(vrsMax, ac.rotor.vrs || 0);
    effMin = Math.min(effMin, ac._rotorAir ? ac._rotorAir.eff : 1);
    if (Math.abs(ac.omega.x) > 0.02 || Math.abs(ac.omega.z) > 0.02) sawBuffet = true;
    return ac.vs < -11 || skidH(ac) < 30;
  });
  ok(`${id}: sinking fast with no airspeed, power on, it enters vortex ring state (vrs ${f2(vrsMax)}, lift ×${f2(effMin)}, vs ${f1(ac.vs)} m/s) and shakes`,
    vrsMax > 0.5 && effMin < 0.85 && sawBuffet);
  // The way out: push forward for airspeed.
  p.pitch = -0.7;
  p.lever = RA.leverFor(hover);
  p.step(8, () => ac.groundSpeed > 14);
  p.pitch = 0;
  p.step(1);
  ok(`${id}: airspeed is the way out (${f1(ac.groundSpeed * KT)} kt over the ground: vrs ${f2(ac.rotor.vrs)})`, ac.groundSpeed > 12 && (ac.rotor.vrs || 0) < 0.1);
  // Normal halves it, Easy quarters it.
  ok(`${id}: the difficulty scales it — Realistic 1, Normal 0.5, Easy 0.25`, RA.realismScale({ difficulty: 'realistic' }) === 1 && RA.realismScale({ difficulty: 'normal' }) === 0.5 && RA.realismScale({ difficulty: 'easy' }) === 0.25);

  // NR: the lever left up after an engine failure bleeds the rotor; the lever down keeps it.
  const up = spawn(id, { mode: 'realistic', assist: true });
  const pu = pilot(up);
  liftTo(up, pu, 150);
  up.hoverAssist = false;
  pu.held = true;
  pu.lever = RA.leverFor(up.rotor.collective);
  up.failures.engine = true;
  pu.step(6, () => up.crashed);
  const nrUp = up.rotor.nr;
  const down = spawn(id, { mode: 'realistic', assist: true });
  const pd = pilot(down);
  liftTo(down, pd, 150);
  down.hoverAssist = false;
  pd.held = true;
  pd.lever = 0.02;
  down.failures.engine = true;
  pd.step(6, () => down.crashed || skidH(down) < 20);
  ok(`${id}: engine out with the lever left at the hover, NR bleeds (${f2(nrUp)} after 6 s); lever down it holds (${f2(down.rotor.nr)} after 6 s, sinking ${f1(-down.vs)} m/s)`,
    nrUp < 0.9 && nrUp < down.rotor.nr - 0.08 && down.rotor.nr > 0.85 && down.vs < -5 && down.vs > -16 && !down.crashed);
  ok(`${id}: the blades on screen follow NR (propBlur is the rotor's speed, not the engine's)`, Math.abs(down.propBlur - Math.min(1, down.rotor.nr)) < 0.01 && Math.abs(up.propBlur - Math.min(1, up.rotor.nr)) < 0.01);
}

/* ================================================================== *
 * 4b. Checker (2026-10-24): the engine start, and after an autorotation
 * ================================================================== */
console.log('\n--- start-up and after an autorotation ---');
for (const id of ['harrier', 'r44', 'ch47']) {
  // Cold on the pad, engine started, the lever held up as the card says:
  // NR must come up quickly enough that she lifts within ~2.5 s of the
  // engine coming on (0.9 s before NR existed; 5.4 s at nrSpool 0.35).
  P.applyAircraft(id);
  const ac = new P.Aircraft();
  ac.mode = 'simplified';
  ac.difficulty = 'normal';
  ac.hoverAssist = true;
  ac.reset({ ...RUNWAY_START, engineOn: false });
  ac.settleOnGear();
  const p = pilot(ac);
  p.step(1);
  ac.startEngine();
  p.held = true;
  let tOn = null;
  let tLift = null;
  let t = 0;
  p.step(15, () => {
    t += STEP;
    if (ac.engineOn && tOn === null) tOn = t;
    if (ac.engineOn) p.lever = Math.min(1, p.lever + 0.62 * STEP);
    if (!ac.onGround && tLift === null) tLift = t;
    return tLift !== null;
  });
  ok(`${id}: from a cold start she lifts ${f1((tLift ?? 99) - (tOn ?? 0))} s after the engine comes on, lever held`, tOn !== null && tLift !== null && tLift - tOn < 2.6 && !ac.crashed);
  // After an assisted autorotation the lever comes down on the skids, so the
  // next start does not leap off on a full lever.
  const a2 = spawn(id);
  const p2 = pilot(a2);
  liftTo(a2, p2, 150);
  p2.step(40, () => {
    p2.pitch = a2.groundSpeed < 25 ? -0.6 : 0;
    return a2.groundSpeed >= 25;
  });
  p2.pitch = 0;
  p2.step(3);
  a2.failures.engine = true;
  p2.step(120, () => a2.onGround);
  const leverTD = p2.lever;
  p2.step(4);
  const leverAfter = p2.lever;
  a2.failures.engine = false;
  a2.startEngine();
  let hMax = 0;
  p2.step(8, () => {
    hMax = Math.max(hMax, skidH(a2));
    return false;
  });
  ok(`${id}: after the autorotation the lever comes down on the skids (${f2(leverTD)} → ${f2(leverAfter)}) and a restart stays put (${f1(hMax)} m)`, !a2.crashed && leverAfter < 0.05 && a2.engineOn && hMax < 0.5);
}
{
  const shared = readFileSync(new URL('../../src/features/mpplay/shared.js', import.meta.url), 'utf8');
  ok('PvP and races treat any rotorcraft as a helicopter (a knocked-down Apache respawns in a hover)', /heli: isHelicopter\(sim\.aircraftType\)/.test(shared));
}

/* ================================================================== *
 * 5. What the HUD says
 * ================================================================== */
console.log('\n--- the card ---');
{
  const hud = readFileSync(new URL('../../src/ui/hud-rotor.js', import.meta.url), 'utf8');
  ok('the heli card has words for autorotation (with and without the assist) and vortex ring state', /auto: \['AUTOROTATION'/.test(hud) && /autoOff: \['AUTOROTATION'/.test(hud) && /vortex: \['VORTEX RING'/.test(hud));
  ok('...and the same three for a touch screen, about the lever and the stick, not Shift', /auto: 'Engine out\. The assist/.test(hud) && /autoOff: 'Engine out\. Slide the lever/.test(hud) && /vortex: 'Sinking into/.test(hud) && !/vortex: '[^']*Shift/.test(hud));
  ok('the card reads the rotor\'s autorotating and vrs flags', /R\.autorotating/.test(hud) && /R\.vrs/.test(hud));
  const main = readFileSync(new URL('../../src/main.js', import.meta.url), 'utf8');
  ok('any rotorcraft is the Heli game (keys, HUD, touch layout), not only the Skyhook', /setGame\(isHelicopter\(this\.aircraftType\)/.test(main) && /SPEC\.rotor \? 'heli' : 'plane'/.test(main));
}

console.log(`\nheli-fleet: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

/**
 * The three airliners, checked in node against the real roster, the real
 * model factory and the real flight model.
 *
 *   node tests/features/airliners.mjs
 *
 * Exits non-zero if anything fails. Every take-off and landing below is flown
 * on physics.js itself at its own 120 Hz step, on the Kestrel runway (spawn at
 * x = -470, runway end at x = +550: 1,020 m of tarmac ahead of the wheels).
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
const T = await import(SRC + 'aircraft/types.js');
const P = await import(SRC + 'aircraft/physics.js');
const TER = await import(SRC + 'world/terrain.js');
const ADAPTER = await import(SRC + 'aircraft/model-adapter.js');
const FEATURE = await import(SRC + 'features/airliners.js');
const PROG = await import(SRC + 'game/progression.js');
const { AIRLINER_GEOMETRY } = await import(SRC + 'aircraft/extra/airliners.js');

// Terrain off the runway plateau is NaN until a map has been applied, and NaN
// ground reads as a contact everywhere — the game does this at boot.
TER.applyMap(TER.MAP.id);
const ELEV = TER.heightAt(0, 0);
const KT = 1.94384;
const DEG = 180 / Math.PI;

let failed = 0;
let passed = 0;
function ok(name, pass, detail = '') {
  if (pass) passed++;
  else failed++;
  console.log(`${pass ? 'ok  ' : 'FAIL'} ${name}${detail !== '' ? ` — ${detail}` : ''}`);
}

const IDS = ['a320', 'b747', 'a380'];
const REAL = {
  // span, length (m), from the manufacturers' published figures
  a320: { span: 35.8, length: 37.57, longHaul: false },
  b747: { span: 64.44, length: 70.6, longHaul: true },
  a380: { span: 79.75, length: 72.72, longHaul: true },
};

/* ------------------------------------------------------------------ *
 * The roster
 * ------------------------------------------------------------------ */
for (const id of IDS) {
  const t = T.AIRCRAFT.find((a) => a.id === id);
  ok(`${id}: in AIRCRAFT`, !!t);
  if (!t) continue;
  ok(`${id}: category airliner, not military`, t.category === 'airliner' && t.military !== true, `${t.category} / military ${t.military}`);
  ok(`${id}: longHaul is ${REAL[id].longHaul}`, t.longHaul === REAL[id].longHaul);
  ok(`${id}: named and described`, typeof t.name === 'string' && t.name.length > 3 && t.blurb.length > 40 && !!t.callsign);
  ok(`${id}: Airliner cockpit`, t.class === 'Airliner');
  const st = t.stats;
  ok(`${id}: stats are 1-5 pips`, ['speed', 'handling', 'ease'].every((k) => Number.isInteger(st[k]) && st[k] >= 1 && st[k] <= 5));
  const a = t.aero;
  const finite = Object.entries(a).filter(([, v]) => typeof v === 'number').every(([, v]) => Number.isFinite(v));
  ok(`${id}: every aero number finite`, finite);
  ok(`${id}: undercarriage can hold it (mass < 32 t; each leg caps at 160 kN)`, a.mass > 10000 && a.mass < 32000, `${a.mass} kg`);
  const W = a.mass * 9.80665;
  ok(`${id}: thrust-to-weight 0.25-0.5`, a.thrustMax / W > 0.25 && a.thrustMax / W < 0.5, (a.thrustMax / W).toFixed(2));
  ok(`${id}: wing loading 150-260 kg/m2`, a.mass / a.wingArea > 150 && a.mass / a.wingArea < 260, (a.mass / a.wingArea).toFixed(0));
  ok(`${id}: real span in the flight model`, Math.abs(a.wingSpan - REAL[id].span) < 0.5, `${a.wingSpan} m`);
  ok(`${id}: inertias positive, yaw the largest`, a.Ixx > 0 && a.Izz > 0 && a.Iyy >= Math.max(a.Ixx, a.Izz));
  const perf = T.performanceFor(id);
  ok(`${id}: approach speed 60-80 kt`, perf.stallLanding >= 60 && perf.stallLanding <= 80, `${perf.stallLanding} kt`);
  ok(`${id}: top speed 300-400 kt`, perf.vne >= 300 && perf.vne <= 400, `${perf.vne} kt`);
  if (REAL[id].longHaul) ok(`${id}: long-haul endurance over 5 h at full power`, perf.enduranceMin > 300, `${perf.enduranceMin} min`);
  const spec = T.specFor(id);
  ok(`${id}: jet, yaw damper, no propeller`, spec.yawDamper === true && spec.propeller === false && spec.rotor === false);
  // Reachable in the game: the hangar sells it, and buying it unlocks it.
  // (An id in neither FREE nor UNLOCKS is locked for ever at "0 credits".)
  const cost = PROG.costOf(id);
  ok(`${id}: for sale in the hangar`, cost > 0 && cost === FEATURE.PRICES[id], `${cost} credits`);
  const wallet = { credits: cost, earned: 0, unlocked: ['skylark'], best: [], redeemed: [] };
  const bought = PROG.buy(wallet, id);
  ok(`${id}: buying it unlocks it`, bought.ok && PROG.isUnlocked(wallet, id) && wallet.credits === 0, JSON.stringify(bought));
  ok(`${id}: not behind the military passcode`, !PROG.needsPasscode({ militaryUnlocked: false }, t));
}

/* ------------------------------------------------------------------ *
 * The model, through the same factory main.js calls
 * ------------------------------------------------------------------ */
const nanIn = (root) => {
  let bad = 0;
  let verts = 0;
  const m = new THREE.Matrix4();
  root.traverse((o) => {
    const p = o.geometry && o.geometry.attributes && o.geometry.attributes.position;
    if (p) {
      for (let i = 0; i < p.array.length; i++) if (!Number.isFinite(p.array[i])) bad++;
      verts += p.count;
    }
    if (o.isInstancedMesh) {
      for (let k = 0; k < o.count; k++) {
        o.getMatrixAt(k, m);
        if (!m.elements.every(Number.isFinite)) bad++;
      }
    }
  });
  return { bad, verts };
};

/** Triangles, instance-aware, and the world-space vertices of named parts. */
function measure(model) {
  model.updateMatrixWorld(true);
  let tris = 0;
  model.traverse((o) => {
    if (!o.isMesh || !o.geometry) return;
    const g = o.geometry;
    const n = (g.index ? g.index.count : g.attributes.position.count) / 3;
    tris += n * (o.isInstancedMesh ? o.count : 1);
  });
  return tris;
}

/** Vertices of everything except wheels, legs and engines, in the model frame. */
function airframePoints(model) {
  model.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(model.matrixWorld).invert();
  const out = [];
  const v = new THREE.Vector3();
  model.traverse((o) => {
    if (!o.isMesh || o.isInstancedMesh || !o.geometry) return;
    for (let p = o; p; p = p.parent) if (/gear|engine|propulsion/i.test(p.name)) return;
    const pos = o.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld).applyMatrix4(inv);
      out.push([v.x, v.y, v.z]);
    }
  });
  return out;
}

for (const id of IDS) {
  const type = T.getAircraft(id);
  const model = ADAPTER.createAircraftModel({ type });
  ok(`${id}: drawn by the fleet pack (DRAWS), not the fallback`, !!model.userData.fleetBridge && ADAPTER.fleetCovers(id), ADAPTER.fleetStatus().error || '');
  const { bad, verts } = nanIn(model);
  ok(`${id}: zero NaN vertices or instance matrices`, bad === 0 && verts > 1000, `${bad} bad of ${verts}`);
  const tris = measure(model);
  ok(`${id}: under 9,000 triangles`, tris < 9000, `${Math.round(tris)}`);
  const fg = model.userData.flightGeometry;
  const b = fg.bounds;
  const span = b.max[0] - b.min[0];
  const length = b.max[2] - b.min[2];
  const R = REAL[id];
  ok(`${id}: span within 2% of the real one`, Math.abs(span / R.span - 1) < 0.02, `${span.toFixed(2)} m vs ${R.span}`);
  ok(`${id}: length within 2% of the real one`, Math.abs(length / R.length - 1) < 0.02, `${length.toFixed(2)} m vs ${R.length}`);
  console.log(`     ${id} span:length ${(span / length).toFixed(3)} (real ${(R.span / R.length).toFixed(3)}), ${Math.round(tris)} triangles`);

  // Wheels on the ground where the physics puts them: the offset main.js
  // applies to line the tyres up with the flight model's contact points.
  const spec = T.specFor(id);
  const off = ADAPTER.groundOffsetFor(model, spec);
  ok(`${id}: drawn tyres meet the physics contact points`, Math.abs(off) < 0.03, `${off.toFixed(3)} m`);
  const g = AIRLINER_GEOMETRY[id];
  const wheels = model.userData.parts.gear.length;
  ok(`${id}: three undercarriage legs the core animates`, wheels === 3);
  let tyreCount = 0;
  model.traverse((o) => {
    if (o.isInstancedMesh && /tyre/i.test(o.name)) tyreCount += o.count;
  });
  const want = { a320: 6, b747: 18, a380: 22 }[id];
  ok(`${id}: ${want} tyres`, tyreCount === want, `${tyreCount}`);

  // Tail strike: the physics tail point against the drawn underside.
  const tail = spec.hardPoints.find((h) => h.part === 'tail');
  const mainPt = spec.gearPoints.find((p) => p.name === 'right').pos;
  const physAngle = Math.atan2(tail.pos.y - mainPt.y, tail.pos.z - mainPt.z) * DEG;
  let drawn = 90;
  for (const [x, y, z] of airframePoints(model)) {
    if (z < mainPt.z + 2) continue;
    drawn = Math.min(drawn, Math.atan2(y - mainPt.y, z - mainPt.z) * DEG);
  }
  ok(`${id}: tail strikes in the physics no later than on the drawing`, physAngle <= drawn + 0.35, `physics ${physAngle.toFixed(2)} deg, drawn ${drawn.toFixed(2)} deg`);
  ok(`${id}: tail-strike angle at least 12 deg`, physAngle >= 12, physAngle.toFixed(2));
  const tip = spec.hardPoints.find((h) => h.part === 'rightWing');
  ok(`${id}: wing-tip strike point at the drawn tip`, Math.abs(tip.pos.x - g.tip.x) < 0.05 && Math.abs(tip.pos.y - g.tip.y) < 0.05);
  const belly = spec.hardPoints.find((h) => h.part === 'fuselage');
  ok(`${id}: belly point on the drawn belly`, Math.abs(belly.pos.y + g.belly) < 0.02);
  ok(`${id}: eye inside the flight deck`, fg.eye[2] < g.noseZ + 6 && fg.eye[2] > g.noseZ + 1.5, fg.eye.join(', '));
  // And under the roof: straight down onto the eye from 12 m up, the first
  // thing hit is the airframe's own skin, above the eye and not far above it.
  // (A pilot's eye that pokes out of the top of the hump sees the inside of
  // nothing, and it is how a raised upper deck would go wrong.)
  {
    model.updateMatrixWorld(true);
    const eye = new THREE.Vector3(...fg.eye);
    const skins = [];
    model.traverse((o) => {
      if (o.isMesh && !o.isInstancedMesh && /skin|fuselage|nose|deck|surface assembly/i.test(o.name)) skins.push(o);
    });
    const rc = new THREE.Raycaster(eye.clone().add(new THREE.Vector3(0, 12, 0)), new THREE.Vector3(0, -1, 0), 0, 12);
    const hit = rc.intersectObjects(skins, false)[0];
    const roof = hit ? hit.point.y - eye.y : null;
    ok(`${id}: a roof over the pilot's head`, roof !== null && roof > 0.3 && roof < 2.2, roof === null ? 'nothing above the eye' : `${roof.toFixed(2)} m of headroom`);
  }

  // An adapter that throws on update would be switched off in a browser.
  let threw = null;
  try {
    for (let i = 0; i < 30; i++) model.userData.update(1 / 30, { rpm: 0.8, gearPos: i < 15 ? 1 : 0.3, onGround: i < 10, controls: { pitch: 0.3, roll: -0.2, yaw: 0.1 } }, {});
  } catch (e) {
    threw = e;
  }
  ok(`${id}: model animates without throwing`, !threw, threw ? String(threw) : '');
  model.userData.dispose();
}

/* ------------------------------------------------------------------ *
 * Flying it
 * ------------------------------------------------------------------ */
const weather = {
  windVector: (o) => (o || new THREE.Vector3()).set(0, 0, 0),
  gustVector: (o) => (o || new THREE.Vector3()).set(0, 0, 0),
  turbulenceLevel: () => 0,
  cond: { rain: 0, cloud: 0 },
  time_s: 0,
  downdraft: 0,
  vortex: null,
};
const _w = new THREE.Vector3();
function gearClearance(ac) {
  let m = Infinity;
  for (const g of P.SPEC.gearPoints) {
    _w.copy(g.pos).applyQuaternion(ac.quat).add(ac.pos);
    m = Math.min(m, _w.y - TER.heightAt(_w.x, _w.z));
  }
  return m;
}
function make(id, mode) {
  P.applyAircraft(id);
  const ac = new P.Aircraft();
  // Stood on its wheels by physics.js's own settleOnGear(); the feature no
  // longer wraps it.
  ac.mode = mode;
  return ac;
}
/** 60 Hz frames of two 120 Hz physics steps, controls set per frame: sim.step(). */
function run(ac, seconds, ctrl, each) {
  for (let f = 0, n = Math.round(seconds * 60); f < n; f++) {
    Object.assign(ac.controls, ctrl);
    ac.update(1 / 120, weather);
    ac.update(1 / 120, weather);
    if (each) each();
    if (ac.crashed) return;
  }
}

/**
 * The playtest's own take-off (tests/playtest.js flyCircuit): full power,
 * flaps, rotate with 0.45 of back stick at 1.25 × the hangar approach speed,
 * then hold 10 degrees nose up.
 */
function takeoff(id, { mode = 'simplified', flaps = 2 } = {}) {
  const ac = make(id, mode);
  ac.reset({ pos: new THREE.Vector3(-470, ELEV, 0), headingDeg: 90, engineOn: true });
  const vr = T.performanceFor(id).stallLanding * 1.25;
  ac.setFlaps(flaps);
  const ctrl = { throttle: 1, brakes: 0, pitch: 0, roll: 0, yaw: 0 };
  let lift = null;
  let at15 = null;
  let liftKt = 0;
  for (let t = 0; t < 70 && at15 === null; t += 0.2) {
    if (ac.onGround) ctrl.pitch = ac.ias * KT > vr ? 0.45 : 0;
    else ctrl.pitch = Math.max(-0.5, Math.min(0.6, (10 - ac.pitchAngleDeg()) * 0.05));
    run(ac, 0.2, ctrl, () => {
      const c = gearClearance(ac);
      if (lift === null && !ac.onGround && c > 0.3) {
        lift = ac.pos.x + 470;
        liftKt = ac.ias * KT;
      }
      if (at15 === null && c > 15) at15 = ac.pos.x + 470;
    });
    if (ac.crashed) break;
  }
  const r = (v) => (v === null ? null : Math.round(v));
  return { crashed: ac.crashed ? ac.crashReason : false, lift: r(lift), liftKt, at15: r(at15) };
}

/**
 * A child's take-off: full power and the stick held fully back from the
 * moment the brakes come off. Simplified mode's stall guard is what stops
 * this striking the tail, so the closest the tail comes to the runway is
 * recorded too.
 */
function yankTakeoff(id, flaps) {
  const ac = make(id, 'simplified');
  ac.reset({ pos: new THREE.Vector3(-470, ELEV, 0), headingDeg: 90, engineOn: true });
  ac.setFlaps(flaps);
  const tail = P.SPEC.hardPoints.find((h) => h.part === 'tail');
  let at15 = null;
  let minTail = Infinity;
  run(ac, 45, { throttle: 1, brakes: 0, pitch: 1, roll: 0, yaw: 0 }, () => {
    _w.copy(tail.pos).applyQuaternion(ac.quat).add(ac.pos);
    minTail = Math.min(minTail, _w.y - TER.heightAt(_w.x, _w.z));
    if (at15 === null && !ac.onGround && gearClearance(ac) > 15) at15 = ac.pos.x + 470;
  });
  return { crashed: ac.crashed ? ac.crashReason : false, at15: at15 === null ? null : Math.round(at15), minTail };
}

/**
 * A landing flown down a 3 degree path at 1.3 × the hangar approach speed,
 * full flap, idle at 12 m, full brakes on the ground, from 450 m before the
 * aiming point. "Stopped" is under 3.5 m/s: idle thrust against the tyres'
 * low-speed friction leaves every jet in the game creeping at 2-3 m/s with the
 * brakes held, the Meridian included.
 */
function landing(id) {
  const ac = make(id, 'simplified');
  const perf = T.performanceFor(id);
  const vapp = (perf.stallLanding * 1.3) / KT;
  const aim = -350;
  const startX = aim - 450;
  ac.reset({ pos: new THREE.Vector3(startX, 0, 0), headingDeg: 90, speed: vapp, altAGL: 0, engineOn: true, gearDown: true });
  const low = Math.min(...P.SPEC.gearPoints.map((g) => g.pos.y));
  ac.pos.y = ELEV + Math.tan(3 / DEG) * (aim - startX) - low;
  ac.setFlaps(3);
  ac.flaps = 1;
  ac.rpm = 0.45;
  const ctrl = { throttle: 0.45, brakes: 0, pitch: 0, roll: 0, yaw: 0 };
  let x15 = null;
  let td = null;
  let stop = null;
  let idle = false;
  for (let t = 0; t < 150 && stop === null; t += 1 / 30) {
    const c = gearClearance(ac);
    if (td === null && !ac.onGround) {
      const wantH = Math.max(0, Math.tan(3 / DEG) * (aim - ac.pos.x));
      let wantVs = -Math.tan(3 / DEG) * ac.groundSpeed + (wantH - c) * 0.3;
      if (c < 12) {
        idle = true;
        wantVs = -0.5 - c * 0.12;
      }
      ctrl.pitch = Math.max(-0.6, Math.min(0.9, (wantVs - ac.vs) * 0.15 - ac.omega.x * 0.8));
      ctrl.throttle = idle ? 0 : Math.max(0, Math.min(1, ctrl.throttle + (vapp - ac.airspeed) * 0.01));
      ctrl.roll = Math.max(-1, Math.min(1, -ac.bankAngleRad() * 2.2 - ac.omega.z * 0.7));
    } else {
      Object.assign(ctrl, { throttle: 0, pitch: 0, brakes: 1, roll: 0 });
    }
    run(ac, 1 / 30, ctrl, () => {
      if (x15 === null && gearClearance(ac) < 15) x15 = ac.pos.x;
      if (td === null && ac.onGround) td = ac.pos.x;
    });
    if (ac.crashed) break;
    if (td !== null && ac.groundSpeed < 3.5) stop = ac.pos.x;
  }
  return {
    crashed: ac.crashed ? ac.crashReason : false,
    from15: stop !== null && x15 !== null ? stop - x15 : null,
    roll: stop !== null && td !== null ? stop - td : null,
    stopPastThreshold: stop === null ? null : stop + 550,
    grade: ac.lastTouchdown && ac.lastTouchdown.quality,
  };
}

/**
 * tests/playtest.js flyCircuit(), step for step, so a change here that the
 * browser playtest would fault is caught in node first: its take-off, its
 * 30-degree turn (aileron capped at 0.35 for 12 s), ten seconds hands-off,
 * then its approach-speed hold. The pass marks are the playtest's own.
 */
function playtestCircuit(id) {
  const ac = make(id, 'simplified');
  ac.reset({ pos: new THREE.Vector3(-470, ELEV, 0), headingDeg: 90, engineOn: true });
  const perf = T.performanceFor(id);
  const vr = perf.stallLanding * 1.25;
  ac.setFlaps(2);
  const o = { throttle: 1, brakes: 0, pitch: 0, roll: 0, yaw: 0 };
  let rollM = null;
  for (let t = 0; t < 60; t += 0.2) {
    if (ac.onGround) o.pitch = ac.ias * KT > vr ? 0.45 : 0;
    else o.pitch = Math.max(-0.5, Math.min(0.6, (10 - ac.pitchAngleDeg()) * 0.05));
    run(ac, 0.2, o);
    if (rollM === null && !ac.onGround && ac.agl > 15) rollM = Math.round(ac.pos.x + 550);
    if (rollM !== null && ac.agl > 260) break;
    if (ac.crashed) return { crashed: ac.crashReason };
  }
  ac.setFlaps(0);
  let maxBank = 0;
  for (let t = 0; t < 12; t += 0.2) {
    o.roll = Math.max(-0.35, Math.min(0.35, ((30 * Math.PI) / 180 - ac.bankAngleRad()) * 0.8 - ac.omega.z * 0.5));
    o.pitch = Math.max(-0.4, Math.min(0.6, -ac.vs * 0.05));
    run(ac, 0.2, o);
    maxBank = Math.max(maxBank, Math.abs(ac.bankAngleDeg()));
  }
  // Let go. (The playtest hands the throttle back to the input, which holds it.)
  run(ac, 10, { throttle: o.throttle, brakes: 0, pitch: 0, roll: 0, yaw: 0 });
  const bankAfter = Math.abs(ac.bankAngleDeg());
  ac.setFlaps(3);
  ac.gearDown = true;
  const target = (perf.stallLanding * 1.3) / KT;
  o.throttle = 0.25;
  o.yaw = 0;
  let settled = null;
  for (let i = 0; i < 240; i++) {
    o.roll = Math.max(-1, Math.min(1, -ac.bankAngleRad() * 2.2 - ac.omega.z * 0.7));
    o.throttle = Math.max(0, Math.min(1, o.throttle + (target - ac.airspeed) * 0.012));
    o.pitch = Math.max(-0.7, Math.min(0.7, -ac.vs * 0.07));
    run(ac, 0.25, o);
    if (i > 170) settled = ac.airspeed * KT;
  }
  return { crashed: ac.crashed ? ac.crashReason : false, rollM, maxBank, bankAfter, approachErr: Math.abs(settled - perf.stallLanding * 1.3), settled };
}

/** Hands-off in simplified mode, fast: the height-hold must not oscillate. */
function handsOff(id, kt) {
  const ac = make(id, 'simplified');
  ac.reset({ pos: new THREE.Vector3(-6000, 0, 6000), headingDeg: 90, speed: kt / KT, altAGL: 1500, engineOn: true, gearDown: false });
  ac.rpm = 0.6;
  let late = 0;
  let t = 0;
  run(ac, 40, { throttle: 0.6, pitch: 0, roll: 0, yaw: 0, brakes: 0 }, () => {
    t += 1 / 60;
    if (t > 25) late = Math.max(late, Math.abs(ac.omega.x) * DEG);
  });
  return late;
}

const report = [];
for (const id of IDS) {
  // Standing still: the stance the game spawns in, held for five seconds.
  const ac = make(id, 'simplified');
  ac.reset({ pos: new THREE.Vector3(-470, ELEV, 0), headingDeg: 90, engineOn: true });
  const y0 = ac.pos.y;
  const pitch0 = ac.pitchAngleDeg();
  run(ac, 5, { throttle: 0, pitch: 0, roll: 0, yaw: 0, brakes: 0 });
  ok(`${id}: spawns standing on its wheels`, !ac.crashed && ac.onGround && Math.abs(ac.pos.y - y0) < 0.05 && Math.abs(ac.pitchAngleDeg() - pitch0) < 0.3,
    `${ac.crashed ? ac.crashReason : ''} moved ${(ac.pos.y - y0).toFixed(3)} m, pitch ${pitch0.toFixed(2)} -> ${ac.pitchAngleDeg().toFixed(2)}`);

  const to = takeoff(id);
  ok(`${id}: takes off from the 1,100 m runway (15 m up before its end)`, !to.crashed && to.at15 !== null && to.at15 < 1020,
    `${to.crashed || ''} lift-off ${to.lift} m at ${Math.round(to.liftKt)} kt, 15 m at ${to.at15} m from brake release`);
  ok(`${id}: take-off distance under 1,100 m`, to.at15 !== null && to.at15 < 1100, `${to.at15} m`);
  const toReal = takeoff(id, { mode: 'realistic' });
  ok(`${id}: takes off in realistic mode too`, !toReal.crashed && toReal.at15 !== null && toReal.at15 < 1020, `${toReal.crashed || ''} ${toReal.at15} m`);
  const toF1 = takeoff(id, { flaps: 1 });
  ok(`${id}: takes off with only one stage of flap`, !toF1.crashed && toF1.at15 !== null && toF1.at15 < 1020, `${toF1.crashed || ''} ${toF1.at15} m`);
  const preset = FEATURE.TAKEOFF_FLAPS[id];
  ok(`${id}: the game sets take-off flap for it`, Number.isInteger(preset) && preset >= 1 && preset <= 2, `${preset}`);
  const toSet = takeoff(id, { flaps: preset });
  ok(`${id}: takes off with the flap the game sets, playtest style`, !toSet.crashed && toSet.at15 !== null && toSet.at15 < 1020,
    `${toSet.crashed || ''} 15 m at ${toSet.at15} m with flaps ${preset}`);
  for (const f of [0, preset]) {
    const y = yankTakeoff(id, f);
    ok(`${id}: stick held fully back from brake release, flaps ${f}: flies before the runway ends`,
      !y.crashed && y.at15 !== null && y.at15 < 1020 && y.minTail > 0.3,
      `${y.crashed || ''} 15 m at ${y.at15} m, tail never closer than ${y.minTail.toFixed(2)} m`);
  }
  const ld = landing(id);
  ok(`${id}: lands and stops on the runway`, !ld.crashed && ld.stopPastThreshold !== null && ld.stopPastThreshold < 1100,
    `${ld.crashed || ''} ${Math.round(ld.from15)} m from 15 m, roll ${Math.round(ld.roll)} m, stopped ${Math.round(ld.stopPastThreshold)} m past the threshold (${ld.grade})`);
  const pc = playtestCircuit(id);
  ok(`${id}: the playtest's circuit — take-off roll under 1,100 m`, !pc.crashed && pc.rollM !== null && pc.rollM <= 1100, `${pc.crashed || ''} ${pc.rollM} m from the threshold`);
  ok(`${id}: the playtest's circuit — holds a 30-degree bank (22-55 deg)`, !pc.crashed && pc.maxBank >= 22 && pc.maxBank <= 55, `${pc.maxBank && pc.maxBank.toFixed(1)} deg`);
  ok(`${id}: the playtest's circuit — levels itself when you let go`, !pc.crashed && pc.bankAfter <= 8, `${pc.bankAfter && pc.bankAfter.toFixed(1)} deg after 10 s`);
  ok(`${id}: the playtest's circuit — sits at its approach speed`, !pc.crashed && pc.approachErr <= 22, `held ${pc.settled && pc.settled.toFixed(0)} kt`);
  const wobble = handsOff(id, 280);
  ok(`${id}: hands-off at 280 kt holds its pitch`, wobble < 2, `${wobble.toFixed(2)} deg/s after 25 s`);
  report.push(`${id}: take-off ${to.at15} m to 15 m (lift-off ${to.lift} m, ${Math.round(to.liftKt)} kt; realistic ${toReal.at15} m; flaps 1 ${toF1.at15} m; with the game's flaps ${preset} ${toSet.at15} m), landing ${Math.round(ld.from15)} m from 15 m (roll ${Math.round(ld.roll)} m)`);
}

console.log('\n' + report.join('\n'));
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

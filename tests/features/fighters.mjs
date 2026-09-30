/**
 * The wishlist jets, checked headless against the real flight model.
 *
 *   node tests/features/fighters.mjs
 *
 * What it proves, for f22, f35b, fa18 and massimo:
 *   - each is in AIRCRAFT with the fields the hangar, the passcode gate and
 *     the carrier read, and numbers in a sane range;
 *   - each builds through createAircraftModel — the call main.js makes —
 *     from the fleet pack, with no NaN anywhere, span:length as claimed, and
 *     the drawn wheels where the physics lands (the model is only ever
 *     shifted vertically to meet the physics, never horizontally);
 *   - each stands level on three wheels when spawned, takes off inside the
 *     1,100 m runway, lands, and can be held under the 2.5 m/s the landing
 *     missions call "stopped" — which a jet's idle thrust can defeat;
 *   - Air Massimo is the fastest aeroplane in the game: highest vne, highest
 *     hangar "Top", and the highest speed actually reached flying level flat
 *     out — every aeroplane in the roster raced, whoever else has added
 *     theirs by the time this runs — except T-Pose Harrison, who is exactly
 *     1 km/h faster than Massimo at both their true top speeds (the owner's
 *     own rule: "1KM faster than Air Massimo");
 *   - the F-35B hovers: a vertical take-off, a height hold, a pad landing, a
 *     conversion from 150 kt, and the hover switching itself off above 60 kt
 *     with a note, without dropping the jet.
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
const { AIRCRAFT, getAircraft, specFor, performanceFor } = await import(SRC + 'aircraft/types.js');
const { createAircraftModel, groundOffsetFor } = await import(SRC + 'aircraft/model-adapter.js');
const { Weather } = await import(SRC + 'world/weather.js');
const Terrain = await import(SRC + 'world/terrain.js');
const Fleet = await import(SRC + 'fleet/extra/fighters.js');
const Stovl = await import(SRC + 'features/stovl.js');
const Ext = await import(SRC + 'game/extensions.js');
Terrain.applyMap('kestrel');

const KT = 1.94384;
const STEP = 1 / 120;
const IDS = ['f22', 'f35b', 'fa18', 'massimo'];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

const results = [];
function ok(name, pass, detail = '') {
  results.push({ name, pass: !!pass, detail: String(detail) });
  console.log(`${pass ? 'ok  ' : 'FAIL'}  ${name}${detail ? '  —  ' + detail : ''}`);
  return !!pass;
}

/* ------------------------------------------------------------ roster --- */
const REAL = {
  // Published span and length, for the proportion check.
  f22: { span: 13.56, length: 18.92, military: true, category: 'military' },
  f35b: { span: 10.67, length: 15.61, military: true, category: 'military' },
  // The Hornet's published 12.31 m includes wingtip missiles; none are drawn.
  fa18: { span: 11.43, length: 17.07, military: true, category: 'military', hook: true },
  massimo: { span: null, length: null, military: false, category: 'special' },
};
for (const id of IDS) {
  const t = AIRCRAFT.find((a) => a.id === id);
  if (!ok(`${id} is in AIRCRAFT`, !!t)) continue;
  const want = REAL[id];
  ok(`${id} category and military flag`, t.category === want.category && !!t.military === want.military,
    `${t.category}, military ${!!t.military}`);
  ok(`${id} has hangar fields`, ['name', 'class', 'blurb', 'livery', 'accent', 'callsign'].every((k) => typeof t[k] === 'string' && t[k])
    && ['speed', 'handling', 'ease'].every((k) => t.stats && t.stats[k] >= 1 && t.stats[k] <= 5));
  ok(`${id} is not long-haul`, !t.longHaul);
  const a = t.aero;
  const W = a.mass * 9.80665;
  const sane = a.mass > 2000 && a.mass < 20000 && a.wingArea > 10 && a.wingSpan > 5 && a.chord > 1
    && a.CLa > 2 && a.alphaStall > 0.2 && a.alphaStall < 0.6 && a.CD0 > 0.003 && a.CD0 < 0.05
    && a.Cmalpha < 0 && a.Cmq < 0 && a.Cmde < 0 && a.Clp < 0 && a.Cnb > 0 && a.Cnr < 0 && a.Clda > 0 && a.Cndr > 0
    && a.thrustMax / W > 0.6 && a.thrustMax / W < 1.6 && a.fuelCapacity > 0 && a.fuelBurnMax > 0 && a.vne > 100;
  ok(`${id} aero numbers are in a sane range`, sane, `T/W ${(a.thrustMax / W).toFixed(2)}, W/S ${(a.mass / a.wingArea).toFixed(0)} kg/m²`);
  const perf = performanceFor(id);
  ok(`${id} approach speed is one a child can fly`, perf.stallLanding >= 50 && perf.stallLanding <= 75, `${perf.stallLanding} kt`);
  ok(`${id} is jet-powered with a jet yaw damper`, t.shape.power.kind === 'jet' && specFor(id).yawDamper === true && !specFor(id).propeller);
}
ok('fa18 has a tail hook for the carrier', getAircraft('fa18').shape.hook === true);
ok('f35b is flagged STOVL, and only it', getAircraft('f35b').stovl === true && IDS.filter((i) => getAircraft(i).stovl).length === 1);
ok('every jet is in the fleet pack DRAWS list', IDS.every((i) => Fleet.DRAWS.includes(i)) && IDS.every((i) => Fleet.DEFINITIONS.some((d) => d.id === i)));

/* ------------------------------------------------------------ models --- */
function measure(model) {
  model.updateMatrixWorld(true);
  const box = new THREE.Box3();
  const v = new THREE.Vector3();
  const M = new THREE.Matrix4();
  const inst = new THREE.Matrix4();
  let nan = 0, tris = 0;
  model.traverse((o) => {
    if (!o.isMesh || !o.geometry || !o.geometry.attributes.position) return;
    const mat = Array.isArray(o.material) ? o.material[0] : o.material;
    const pos = o.geometry.attributes.position;
    for (let i = 0; i < pos.array.length; i++) if (!Number.isFinite(pos.array[i])) nan++;
    tris += (o.geometry.index ? o.geometry.index.count : pos.count) / 3 * (o.isInstancedMesh ? o.count : 1);
    // Bounds of the airframe only: not the flames, not the decal cards.
    let hidden = false;
    for (let p = o; p; p = p.parent) if (!p.visible) hidden = true;
    if (hidden || (mat && (mat.transparent || /afterburner/.test(mat.name || '')))) return;
    const copies = o.isInstancedMesh ? o.count : 1;
    for (let k = 0; k < copies; k++) {
      if (o.isInstancedMesh) { o.getMatrixAt(k, inst); M.multiplyMatrices(o.matrixWorld, inst); } else M.copy(o.matrixWorld);
      for (let i = 0; i < pos.count; i++) box.expandByPoint(v.fromBufferAttribute(pos, i).applyMatrix4(M));
    }
    if (o.isInstancedMesh) {
      for (let k = 0; k < o.count; k++) { o.getMatrixAt(k, inst); for (const e of inst.elements) if (!Number.isFinite(e)) nan++; }
    }
  });
  return { box, nan, tris };
}

for (const id of IDS) {
  const type = getAircraft(id);
  let model = null;
  try { model = createAircraftModel({ type }); } catch (e) { ok(`${id} builds`, false, e.message); continue; }
  ok(`${id} is drawn by the fleet pack, not the fallback`, !!model.userData.fleetBridge);
  // Wind every animation through a few frames at full power, gear up and
  // down, so an animation that writes a NaN is caught too.
  for (const [rpm, gear] of [[1, 1], [1, 0], [0.2, 1]]) {
    for (let i = 0; i < 20; i++) model.userData.update(1 / 30, { rpm, gearPos: gear, controls: { pitch: 0.4, roll: -0.3, yaw: 0.2 } }, { cond: { cloud: 0 } });
  }
  const { box, nan, tris } = measure(model);
  if (id === 'f22') {
    // Its weapons are inside it: the bay doors on the belly and trunks.
    let doors = null;
    model.traverse((o) => { if (o.isMesh && o.name === 'internal weapon bay doors') doors = o; });
    const n = doors ? doors.geometry.attributes.position.count / 3 : 0;
    let below = 0;
    if (doors) { const p = doors.geometry.attributes.position; for (let i = 0; i < p.count; i++) if (p.getY(i) < -0.15) below++; }
    ok('f22 has its internal weapon bay doors drawn', !!doors && n >= 20 && below === doors.geometry.attributes.position.count,
      `${n} triangles, ${below} of ${doors ? doors.geometry.attributes.position.count : 0} vertices under the chine`);
  }
  ok(`${id} has zero NaN vertices`, nan === 0, `${nan} NaN, ${Math.round(tris)} triangles`);
  ok(`${id} triangle budget (under 2,500, the Vanguard is 1,570)`, tris < 2500, `${Math.round(tris)}`);
  const size = box.getSize(new THREE.Vector3());
  const real = REAL[id];
  if (real.span) {
    const ratio = size.x / size.z, realRatio = real.span / real.length;
    ok(`${id} span:length within 8% of the real aircraft`, Math.abs(ratio / realRatio - 1) < 0.08,
      `${size.x.toFixed(2)} x ${size.z.toFixed(2)} m = ${ratio.toFixed(3)}, real ${realRatio.toFixed(3)}`);
    ok(`${id} length within 8% of the real one`, Math.abs(size.z / real.length - 1) < 0.08, `${size.z.toFixed(2)} m against ${real.length}`);
  } else {
    ok(`${id} is the long, pointy one (span:length under .5)`, size.x / size.z < 0.5, `${(size.x / size.z).toFixed(3)}`);
  }
  // Drawn wheels where the physics lands: tyre bottoms at the physics'
  // contact height (no vertical shift needed), mains at the same x and z.
  model.userData.update(0, { rpm: 0, gearPos: 1 }, { cond: { cloud: 0 } });
  const spec = specFor(id);
  const shift = groundOffsetFor(model, spec);
  ok(`${id} drawn tyres meet the physics contact height`, Math.abs(shift) < 0.03, `offset ${shift.toFixed(3)} m`);
  const def = Fleet.DEFINITIONS.find((d) => d.id === id);
  const phys = spec.gearPoints.find((g) => g.name === 'right').pos;
  ok(`${id} drawn main gear is where the physics' is`, Math.abs(def.gear.main[0] - phys.x) < 0.05 && Math.abs(def.gear.main[2] - phys.z) < 0.05,
    `drawn ${def.gear.main[0]},${def.gear.main[2]} physics ${phys.x.toFixed(2)},${phys.z.toFixed(2)}`);
  model.userData.dispose && model.userData.dispose();
}

/* ------------------------------------------------------- flight tests --- */
function fly(id, mode = 'simplified', wind = 0) {
  P.applyAircraft(id);
  const ac = new P.Aircraft();
  ac.mode = mode;
  const w = new Weather();
  w.windSpeedKts = wind;
  w.windDirDeg = 90;
  return { ac, w };
}
const pitchDeg = (ac) => Math.asin(clamp(new THREE.Vector3(0, 0, -1).applyQuaternion(ac.quat).y, -1, 1)) * 57.2958;
function steer(ac) {
  const hdgErr = ((ac.heading - 90 + 540) % 360) - 180;
  const wantBank = clamp(-ac.pos.z * 0.35 - hdgErr * 0.9, -14, 14);
  ac.controls.roll = clamp((wantBank - ac.bankAngleDeg()) / 16, -0.7, 0.7);
  ac.controls.yaw = clamp(-hdgErr / 26, -0.6, 0.6);
}

for (const id of IDS) {
  // Spawned on the runway, left alone for three seconds.
  {
    const { ac, w } = fly(id);
    let crash = null;
    ac.on(P.EVENTS.CRASH, (e) => { crash = e && e.reason; });
    ac.reset({ pos: new THREE.Vector3(-530, 0, 0), headingDeg: 90, engineOn: true });
    for (let i = 0; i < 360 && !ac.crashed; i++) ac.update(STEP, w);
    ok(`${id} stands level on three wheels when spawned`, !ac.crashed && ac.contactCount === 3 && Math.abs(pitchDeg(ac)) < 2 && Math.abs(ac.bankAngleDeg()) < 0.5,
      `${crash || ''} contacts ${ac.contactCount}, pitch ${pitchDeg(ac).toFixed(2)}, bank ${ac.bankAngleDeg().toFixed(2)}`);
  }
  // Take-off from the western threshold: full power, rotate a little below
  // the clean stall, hold 11 degrees.
  for (const mode of ['simplified', 'realistic']) {
    const { ac, w } = fly(id, mode);
    let crash = null;
    ac.on(P.EVENTS.CRASH, (e) => { crash = e && e.reason; });
    ac.reset({ pos: new THREE.Vector3(-530, 0, 0), headingDeg: 90, engineOn: true });
    const vr = (performanceFor(id).stallClean / KT) * 0.95;
    let lift = null;
    for (let t = 0; t < 60 && !ac.crashed; t += STEP) {
      ac.controls.throttle = 1;
      steer(ac);
      if (ac.ias < vr && ac.onGround) ac.controls.pitch = 0;
      else ac.controls.pitch = clamp((11 - pitchDeg(ac)) * 0.08 - ac.omega.x * 1.2, -1, 1);
      ac.update(STEP, w);
      if (lift === null && !ac.onGround && ac.agl > 1.5) lift = ac.pos.x + 530;
      if (lift !== null && ac.agl > 30) break;
    }
    ok(`${id} takes off inside the 1,100 m runway (${mode})`, !ac.crashed && lift !== null && lift < 800,
      `${crash || ''} airborne after ${lift === null ? '—' : Math.round(lift)} m`);
  }
  // Landing: a 3.5 degree approach at 1.3 x the landing stall, full flap,
  // flare, brakes. Must not crash, must stop on the runway.
  for (const mode of ['simplified', 'realistic']) {
    const { ac, w } = fly(id, mode);
    const vapp = Math.max(performanceFor(id).stallLanding * 1.3, performanceFor(id).stallLanding + 15) / KT;
    const AIM = -250, dist = 3500;
    let crash = null, td = null, stop = null;
    ac.on(P.EVENTS.CRASH, (e) => { crash = e && e.reason; });
    ac.on(P.EVENTS.TOUCHDOWN, (g) => { if (!td) td = g; });
    ac.reset({ pos: new THREE.Vector3(AIM - dist, 0, 0), headingDeg: 90, engineOn: true, gearDown: true, speed: vapp, altAGL: 50 });
    ac.pos.y = 14 + dist * Math.tan(3.5 * Math.PI / 180);
    ac.setFlaps(3);
    ac.flaps = 1;
    let thr = 0.4, eInt = 0.1;
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
        ac.controls.throttle = 0; ac.controls.pitch = 0; ac.controls.roll = 0; ac.controls.brakes = 1;
        ac.controls.yaw = clamp(-(((ac.heading - 90 + 540) % 360) - 180) / 20, -1, 1);
      }
      ac.update(STEP, w);
      if (td && ac.groundSpeed < 2.5 && ac.groundTime > 1.2) { stop = ac.pos.x; break; }
    }
    ok(`${id} lands and stops on the runway (${mode})`, !ac.crashed && td && !td.crashed && stop !== null && stop < 550,
      `${crash || ''} touchdown ${td ? td.vsFpm + ' fpm ' + td.quality : '—'}, stopped at x ${stop === null ? '—' : Math.round(stop)} (runway ends at 550)`);
  }
  // Idle creep with the brakes on: the missions' "stopped" is under 2.5 m/s.
  {
    const { ac, w } = fly(id);
    ac.reset({ pos: new THREE.Vector3(-400, 0, 0), headingDeg: 90, engineOn: true, speed: 6 });
    ac.parkingBrake = false;
    for (let t = 0; t < 20; t += STEP) { ac.controls.throttle = 0; ac.controls.brakes = 1; ac.update(STEP, w); }
    ok(`${id} can be held below 2.5 m/s at idle on the brakes`, ac.groundSpeed < 2.3, `${ac.groundSpeed.toFixed(2)} m/s`);
  }
}

/* -------------------------------------------------- the fastest plane --- */
function topSpeed(id, seconds = 300) {
  const { ac, w } = fly(id);
  const alt = 2500;
  ac.reset({ pos: new THREE.Vector3(-3000, 0, 0), headingDeg: 90, engineOn: true, gearDown: false, speed: 90, altAGL: alt });
  ac.pos.y = alt;
  ac.rpm = 1;
  for (let t = 0; t < seconds && !ac.crashed; t += STEP) {
    ac.controls.throttle = 1;
    const hdgErr = ((ac.heading - 90 + 540) % 360) - 180;
    ac.controls.roll = clamp((clamp(-hdgErr * 0.9, -14, 14) - ac.bankAngleDeg()) / 16, -0.7, 0.7);
    ac.controls.yaw = clamp(-hdgErr / 26, -0.6, 0.6);
    const wantVs = clamp((alt - ac.pos.y) * 0.1, -6, 6);
    ac.controls.pitch = clamp((wantVs - ac.vs) * 0.06 - ac.omega.x, -0.8, 0.9);
    ac.update(STEP, w);
  }
  return { kt: ac.airspeed * KT, crashed: ac.crashed };
}
const race = [];
for (const t of AIRCRAFT) {
  if (t.shape && t.shape.power && t.shape.power.rotor) continue; // blade stall caps it far below
  race.push({ id: t.id, ...topSpeed(t.id), vne: performanceFor(t.id).vne });
}
race.sort((a, b) => b.kt - a.kt);
console.log('      level top speed at 2,500 m, true airspeed: ' + race.map((r) => `${r.id} ${Math.round(r.kt)}`).join(', '));
/*
 * T-Pose Harrison (extra/tpose.js) is the one exception, on purpose: the
 * owner asked for him to be exactly 1 km/h faster than Massimo. Everything
 * else must still be 15% behind Massimo; Harrison is held to his one km/h
 * below, at both aeroplanes' TRUE top speed.
 */
const FASTER = new Set(['massimo', 'tpose']);
const m = race.find((r) => r.id === 'massimo');
const rest = race.filter((r) => !FASTER.has(r.id));
ok('massimo reaches the highest level top speed of every aeroplane in the game (but T-Pose Harrison), by 15% or more',
  m && !m.crashed && rest.every((r) => m.kt > r.kt * 1.15), `${Math.round(m.kt)} kt against ${rest[0].id} ${Math.round(rest[0].kt)} kt`);
{
  // Flown until the speed stops rising: at the race's 300 s both are still
  // accelerating (Massimo 881 km/h there, 941.5 at the top).
  const mt = topSpeed('massimo', 1800);
  const ht = topSpeed('tpose', 1800);
  const d = (ht.kt - mt.kt) / KT * 3.6;
  ok('T-Pose Harrison is 1 km/h faster than Air Massimo at top speed (measured, ± 0.25)',
    !mt.crashed && !ht.crashed && Math.abs(d - 1) <= 0.25,
    `Massimo ${(mt.kt / KT * 3.6).toFixed(2)} km/h, Harrison ${(ht.kt / KT * 3.6).toFixed(2)} km/h: ${d >= 0 ? '+' : ''}${d.toFixed(3)} km/h`);
  ok('T-Pose Harrison is not military (no passcode) and has a higher red line than Massimo',
    !getAircraft('tpose').military && getAircraft('tpose').aero.vne > getAircraft('massimo').aero.vne);
}
const others = AIRCRAFT.filter((a) => !FASTER.has(a.id));
ok('massimo has the highest vne in the roster', others.every((a) => getAircraft('massimo').aero.vne > a.aero.vne),
  `${getAircraft('massimo').aero.vne} m/s against ${Math.max(...others.map((a) => a.aero.vne))}`);
ok('massimo shows the highest "Top" in the hangar', others.every((a) => performanceFor('massimo').vne > performanceFor(a.id).vne),
  `${performanceFor('massimo').vne} kt`);
ok('massimo is not military (no passcode)', !getAircraft('massimo').military);

/* ------------------------------------------------------------- hover --- */
function hoverWorld(wind, condition = 'clear') {
  const w = new Weather();
  w.windSpeedKts = wind;
  w.windDirDeg = 150;
  w.condition = condition;
  return w;
}
function hoverStep(ac, ctl, w, seconds) {
  for (let i = 0; i < Math.round(seconds * 120); i++) {
    if (ctl.active) ctl.preStep(ac, STEP);
    ac.update(STEP, w);
    if (ctl.active) ctl.postStep(ac, STEP);
    w.update(STEP);
    if (ac.crashed) return false;
  }
  return true;
}
for (const [mode, wind, cond] of [['simplified', 0, 'clear'], ['simplified', 20, 'rainy'], ['realistic', 26, 'stormy']]) {
  const tag = `${mode}, ${wind} kt ${cond}`;
  P.applyAircraft('f35b');
  const ac = new P.Aircraft();
  ac.mode = mode;
  const w = hoverWorld(wind, cond);
  const ctl = new Stovl.StovlController();
  let td = null;
  ac.on(P.EVENTS.TOUCHDOWN, (g) => { if (!td) td = g; });
  ac.reset({ pos: new THREE.Vector3(0, 0, 0), headingDeg: 90, engineOn: true });
  hoverStep(ac, ctl, w, 1);
  const x0 = ac.pos.x, z0 = ac.pos.z;
  ok(`f35b: T on the ground puts the nozzle down (${tag})`, ctl.toggle(ac) === 'hover');
  ac.controls.throttle = 1;
  hoverStep(ac, ctl, w, 8);
  ok(`f35b: vertical take-off climbs straight up (${tag})`, !ac.crashed && ac.agl > 25 && Math.hypot(ac.pos.x - x0, ac.pos.z - z0) < 6,
    `${ac.agl.toFixed(1)} m up, ${Math.hypot(ac.pos.x - x0, ac.pos.z - z0).toFixed(1)} m off the spot`);
  ac.controls.throttle = 0.5;
  hoverStep(ac, ctl, w, 4);
  let lo = 1e9, hi = -1e9, far = 0;
  for (let i = 0; i < 30 * 120 && !ac.crashed; i++) {
    hoverStep(ac, ctl, w, 1 / 120);
    lo = Math.min(lo, ac.pos.y); hi = Math.max(hi, ac.pos.y);
    far = Math.max(far, Math.hypot(ac.pos.x - x0, ac.pos.z - z0));
  }
  ok(`f35b: hands-off hover holds height and position for 30 s (${tag})`, !ac.crashed && hi - lo < 2.5 && far < 8,
    `height band ${(hi - lo).toFixed(2)} m, furthest ${far.toFixed(1)} m from the take-off spot`);
  ac.controls.throttle = 0;
  hoverStep(ac, ctl, w, 20);
  ok(`f35b: lever down lands it gently on the spot (${tag})`, !ac.crashed && td && !td.crashed && Math.abs(td.vsFpm) < 300
    && Math.hypot(ac.pos.x - x0, ac.pos.z - z0) < 8,
  `${td ? td.vsFpm + ' fpm, ' + td.quality : 'no touchdown'}, ${Math.hypot(ac.pos.x - x0, ac.pos.z - z0).toFixed(1)} m from where it lifted`);
  ok(`f35b: T on the ground stows the nozzle (${tag})`, ctl.toggle(ac) === 'stowed');
  hoverStep(ac, ctl, w, 3);
  ok(`f35b: forward thrust is given back once the nozzle is aft (${tag})`, P.SPEC.thrustMax === getAircraft('f35b').aero.thrustMax && !ctl.active,
    `${P.SPEC.thrustMax}`);
}
{
  // Convert from 150 kt at 180 m, hover, then leave past 60 kt.
  P.applyAircraft('f35b');
  const ac = new P.Aircraft();
  ac.mode = 'simplified';
  const w = hoverWorld(0);
  const ctl = new Stovl.StovlController();
  ac.reset({ pos: new THREE.Vector3(-6000, 0, 0), headingDeg: 90, engineOn: true, gearDown: true, speed: 150 / KT, altAGL: 150 });
  ac.pos.y = 180;
  ac.rpm = 0.6;
  const hold = (alt) => { ac.controls.pitch = clamp((alt - ac.pos.y) * 0.02 - ac.vs * 0.08 - ac.omega.x, -1, 1); };
  for (let i = 0; i < 600; i++) { hold(180); ac.controls.throttle = 0.6; hoverStep(ac, ctl, w, STEP); }
  ok('f35b: T at 150 kt starts a conversion', ctl.toggle(ac) === 'convert');
  ac.controls.throttle = 0.5;
  ac.controls.pitch = 0;
  let low = ac.pos.y, reached = null;
  for (let t = 0; t < 45 && !ac.crashed && reached === null; t += 1 / 120) {
    hoverStep(ac, ctl, w, 1 / 120);
    low = Math.min(low, ac.pos.y);
    if (ctl.mode === 'hover') reached = t;
  }
  ok('f35b: the conversion slows it to a hover without losing height', reached !== null && reached < 35 && 180 - low < 8,
    `hover after ${reached === null ? '—' : reached.toFixed(1)} s, lowest ${low.toFixed(1)} m of 180`);
  hoverStep(ac, ctl, w, 10);
  ctl.notes.length = 0;
  // Full forward stick with the lever up (W + Shift: fly away), and the
  // stick kept there three seconds after the hover lets go — the worst thing
  // a child holding W can do. (W alone now hover-taxis: aircrew.browser.js.)
  const y0 = ac.pos.y;
  let offKt = null, exitT = null, yOff = y0;
  low = ac.pos.y;
  for (let t = 0; t < 40 && !ac.crashed; t += 1 / 120) {
    if (ctl.mode === 'hover') ac.controls.pitch = -1;
    else {
      // Held level where the hover let go: the lever just above the hold
      // band climbs it gently on the way there.
      if (exitT === null) { exitT = t; offKt = ac.ias * KT; yOff = ac.pos.y; }
      if (t < exitT + 3) ac.controls.pitch = -1; else hold(yOff);
    }
    ac.controls.throttle = ctl.mode === 'hover' ? 0.7 : 1;
    hoverStep(ac, ctl, w, 1 / 120);
    low = Math.min(low, ac.pos.y);
  }
  ok('f35b: the hover switches itself off just above 60 kt, and says so', offKt !== null && offKt > 58 && offKt < 70
    && ctl.notes.some((n) => /60 knots/.test(n.text)), `off at ${offKt === null ? '—' : offKt.toFixed(1)} kt: "${(ctl.notes[0] || {}).text || ''}"`);
  ok('f35b: leaving the hover does not drop the jet', !ac.crashed && y0 - low < 8 && ctl.mode === 'off' && ac.ias * KT > 150,
    `lost ${(y0 - low).toFixed(1)} m, now ${(ac.ias * KT).toFixed(0)} kt, mode ${ctl.mode}`);
  ok('f35b: thrust is whole again after the hover', P.SPEC.thrustMax === getAircraft('f35b').aero.thrustMax);
}

/* ------------------------------------------------ leaving the hover --- */
/*
 * Through the extension, the way main.js drives it: a 60 Hz frame with
 * input.js's throttle smoothing (out.throttle eases toward throttleTarget at
 * 6/s), two 120 Hz steps through the wrapped aircraft.update, then the
 * update hook. From the real spawn, 80 m in from the west threshold facing
 * east, so the 28 m rise past the runway's far end is in the way.
 *
 * The first pass failed this: T from a 15 m hover with the lever left in
 * the middle — where the hover had put it — sank to 1.9 m and put a wing tip
 * on the ground in simplified mode, and crashed during the exit in realistic
 * mode; the handover then dropped 0.2-0.26 g of jet lift in one step.
 *
 * lever 'keys' is the keyboard lever, which the hover moves (to full power
 * on the way out). A number is a finger held on the touch slider, which
 * wins over anything the hover asks for — so the exit must be safe there too.
 */
const stovlExt = Ext.extensions().find((e) => e.id === 'stovl');
const aboveSurface = (ac) => ac.pos.y - Math.max(0, ac.pos.y - ac.agl);
function gameHover({ H, mode, lever = 'keys', x = -470, hdg = 90 }) {
  P.applyAircraft('f35b');
  const ac = new P.Aircraft();
  ac.mode = mode;
  const w = hoverWorld(0);
  const notes = [];
  const sim = {
    state: 'flying', mode: 'free', aircraftType: getAircraft('f35b'), aircraft: ac,
    input: { throttleTarget: 0.5 }, hud: { notify: (t) => notes.push(t) },
  };
  const out = { ac, sim, notes, crash: null };
  ac.on(P.EVENTS.CRASH, (e) => { out.crash = (e && e.reason) || 'crashed'; });
  stovlExt.startMode(sim, 'free', {});
  ac.reset({ pos: new THREE.Vector3(x, 0, 0), headingDeg: hdg, speed: 0, altAGL: H, engineOn: true, gearDown: true });
  ac.rpm = 0.6;
  const ctl = Stovl.stovlState();
  ctl.nozzle = 1;
  ctl.toggle(ac);
  let thr = 0.5;
  out.frame = (pitch = 0) => {
    if (typeof lever === 'number') sim.input.throttleTarget = lever;
    thr += (sim.input.throttleTarget - thr) * 0.1;
    ac.controls.throttle = thr;
    ac.controls.pitch = pitch;
    ac.controls.roll = 0;
    ac.controls.yaw = 0;
    ac.controls.brakes = 0;
    for (let k = 0; k < 2; k++) { ac.update(STEP, w); w.update(STEP); }
    stovlExt.update(sim, 1 / 60);
  };
  for (let i = 0; i < 300; i++) out.frame();
  out.pressT = () => { stovlExt.key(sim, 'KeyT', true, {}); stovlExt.key(sim, 'KeyT', false, {}); };
  return out;
}
for (const mode of ['simplified', 'realistic']) {
  for (const H of [15, 25]) {
    for (const lever of ['keys', 0.5]) {
      const tag = `${mode}, ${H} m hover, lever ${lever === 'keys' ? 'on the keys' : 'held at 0.5 on the touch slider'}`;
      const g = gameHover({ H, mode, lever });
      const { ac, sim } = g;
      const ctl = Stovl.stovlState();
      const y0 = ac.pos.y;
      g.pressT();
      if (lever === 'keys') ok(`f35b: T to fly away puts the keyboard lever to full power (${tag})`, ctl.mode === 'exit' && sim.input.throttleTarget === 1, `mode ${ctl.mode}, lever ${sim.input.throttleTarget}`);
      let low = y0, hand = null, handLift = null, drop = 0, vsAfter = 1e9, lowAfter = 1e9;
      for (let i = 0; i < 60 * 60 && !ac.crashed; i++) {
        const was = ctl.mode, before = ctl.lift;
        g.frame();
        low = Math.min(low, ac.pos.y);
        if (was === 'exit' && ctl.mode === 'off' && hand === null) { hand = i / 60; handLift = before; }
        drop = Math.max(drop, before - ctl.lift);
        if (hand !== null) {
          lowAfter = Math.min(lowAfter, aboveSurface(ac));
          if (i / 60 < hand + 4) vsAfter = Math.min(vsAfter, ac.vs);
        }
      }
      ok(`f35b: T from the hover flies away without coming down (${tag})`, !ac.crashed && y0 - low < 1.5 && hand !== null,
        `${g.crash || 'no crash'}, lowest ${(low - y0).toFixed(2)} m from the hover, handed to the wing after ${hand === null ? '—' : hand.toFixed(1) + ' s'}`);
      ok(`f35b: the wing is carrying it at the handover, and the jet lift is eased off, never cut (${tag})`, hand !== null && handLift < 0.15 && drop < 0.03 && vsAfter > -2.5,
        `jet lift ${handLift === null ? '—' : handLift.toFixed(2)} g at the handover, largest drop ${drop.toFixed(3)} g in a frame from T on, lowest vs in the 4 s after ${vsAfter === 1e9 ? '—' : vsAfter.toFixed(2)} m/s`);
      ok(`f35b: hands off after the handover it clears the rise past the runway (${tag})`, !ac.crashed && lowAfter > 15,
        `lowest ${lowAfter === 1e9 ? '—' : lowAfter.toFixed(1)} m over the ground after the handover, ${Math.round(ac.ias * KT)} kt at the end`);
      ok(`f35b: the thrust is whole once the hover has let go (${tag})`, ctl.mode === 'off' && !ctl.active && P.SPEC.thrustMax === getAircraft('f35b').aero.thrustMax && !ac.jetBorne);
    }
  }
}
for (const mode of ['simplified', 'realistic']) {
  // W is "go forward" in a hover and "nose down" on the wing. Held from the
  // hover straight through the switch-off and on — for 70 s, past the 45 s
  // clock that used to hand it back anyway and dive the jet into the sea —
  // it must not be handed back as a dive; let go, and the jet flies away.
  const g = gameHover({ H: 25, mode });
  const { ac } = g;
  const ctl = Stovl.stovlState();
  // W + Shift: stick forward with the lever up is how a hover flies away.
  g.sim.input.throttleTarget = 1;
  let offAt = null, lowHeld = 1e9;
  for (let i = 0; i < 70 * 60 && !ac.crashed; i++) {
    g.frame(-1);
    if (offAt === null && ctl.mode !== 'hover') offAt = i / 60;
    if (offAt !== null && i / 60 > offAt + 15) lowHeld = Math.min(lowHeld, aboveSurface(ac));
  }
  const waiting = ctl.mode === 'exit' && ctl.waitingForStick;
  let hand = null;
  for (let i = 0; i < 30 * 60 && !ac.crashed; i++) { g.frame(0); if (hand === null && ctl.mode === 'off') hand = i / 60; }
  ok(`f35b: W held through the switch-off is not handed back as a dive; let go and it flies away (${mode})`, !ac.crashed && offAt !== null && waiting && lowHeld > 40 && hand !== null,
    `${g.crash || 'no crash'}, hover off at ${offAt === null ? '—' : offAt.toFixed(1)} s, still waiting for the stick at 70 s: ${waiting}, lowest ${lowHeld === 1e9 ? '—' : lowHeld.toFixed(0)} m over the ground while held, handed over ${hand === null ? '—' : hand.toFixed(1) + ' s'} after letting go, ${Math.round(aboveSurface(ac))} m up`);
}
{
  // "Able to move while hovering": W alone, held 20 s at the hover's lever,
  // slides the jet forward at a hover-taxi and the hover stays on.
  const g = gameHover({ H: 25, mode: 'simplified' });
  const { ac } = g;
  const ctl = Stovl.stovlState();
  const x0 = ac.pos.x;
  let maxKt = 0;
  for (let i = 0; i < 20 * 60 && !ac.crashed; i++) { g.frame(-1); maxKt = Math.max(maxKt, ac.ias * KT); }
  ok('f35b: W alone in a hover slides forward and stays in the hover (no drop-out)', !ac.crashed && ctl.mode === 'hover' && ac.pos.x - x0 > 150 && maxKt < 50,
    `${Math.round(ac.pos.x - x0)} m forward in 20 s, fastest ${maxKt.toFixed(0)} kt, mode ${ctl.mode}`);
}
{
  // A finger holding the touch slider at 20% after T: not enough to fly
  // away, so after a while it goes back to the hover rather than hanging on
  // the nozzle, and says why.
  const g = gameHover({ H: 25, mode: 'simplified', lever: 0.2 });
  const { ac } = g;
  const ctl = Stovl.stovlState();
  const y0 = ac.pos.y;
  g.pressT();
  let low = y0, back = null;
  for (let i = 0; i < 15 * 60 && !ac.crashed; i++) { g.frame(); low = Math.min(low, ac.pos.y); if (back === null && ctl.mode === 'hover') back = i / 60; }
  ok('f35b: T with the lever held low goes back to the hover, says so, and keeps its height', !ac.crashed && back !== null && y0 - low < 1.5
    && g.notes.some((n) => /back in the hover/.test(n)), `back in the hover after ${back === null ? '—' : back.toFixed(1)} s, lowest ${(low - y0).toFixed(2)} m`);
}
{
  // T on the take-off roll: the first pass parked the jet — no thrust, the
  // brakes full on at 30 kt.
  P.applyAircraft('f35b');
  const ac = new P.Aircraft();
  const w = hoverWorld(0);
  const ctl = new Stovl.StovlController();
  ac.reset({ pos: new THREE.Vector3(-470, 0, 0), headingDeg: 90, engineOn: true });
  for (let t = 0; t < 30 && ac.groundSpeed * KT < 30; t += STEP) { ac.controls.throttle = 1; hoverStep(ac, ctl, w, STEP); }
  const kt = ac.groundSpeed * KT;
  const what = ctl.toggle(ac);
  hoverStep(ac, ctl, w, 1);
  ok('f35b: T on the take-off roll is refused, with a note, and the roll carries on', what === 'rolling' && ctl.mode === 'off'
    && P.SPEC.thrustMax === getAircraft('f35b').aero.thrustMax && ac.groundSpeed * KT > kt && ctl.notes.some((n) => /Stop first/.test(n.text)),
  `${what} at ${kt.toFixed(0)} kt, ${(ac.groundSpeed * KT).toFixed(0)} kt a second later`);
}
{
  // Out of the cockpit. Drive mode keeps state 'flying' and the last
  // aircraftType; the first pass still showed the HOVER panel in the boat and
  // took T from it, putting the parked jet into a hover.
  const g = gameHover({ H: 20, mode: 'simplified' });
  const { sim, ac } = g;
  const ctl = Stovl.stovlState();
  sim.mode = 'drive';
  stovlExt.startMode(sim, 'drive', { kind: 'boat' });
  stovlExt.update(sim, 1 / 60);
  const offNow = ctl.mode === 'off' && !ctl.active && P.SPEC.thrustMax === getAircraft('f35b').aero.thrustMax && !ac.jetBorne;
  const taken = stovlExt.key(sim, 'KeyT', true, {});
  stovlExt.key(sim, 'KeyT', false, {});
  stovlExt.update(sim, 1 / 60);
  ok('f35b: in the boat or the car the hover is off and T is left alone', offNow && taken === false && ctl.mode === 'off',
    `hover ${ctl.mode}, T consumed ${taken}`);
  sim.mode = 'free';
  sim.onFoot = { active: true };
  ok('f35b: on foot, T is left alone too', stovlExt.key(sim, 'KeyT', true, {}) === false && ctl.mode === 'off');
  delete sim.onFoot;
  // The on-foot feature as it stands sets no flag; it holds the empty
  // aeroplane parked through sim.override while you walk about. You can only
  // get out on the ground, so that is where the jet is put for this.
  const PARK = { throttle: 0, brakes: 1, pitch: 0, roll: 0, yaw: 0 };
  sim.override = PARK;
  ac.reset({ pos: new THREE.Vector3(-470, 0, 0), headingDeg: 90, engineOn: true });
  for (let i = 0; i < 120; i++) ac.update(STEP, hoverWorld(0));
  ok('f35b: walking about beside the parked jet (controls held parked), T is left alone',
    ac.onGround && stovlExt.key(sim, 'KeyT', true, {}) === false && ctl.mode === 'off');
  sim.override = { throttle: 0.5 };
  ok('f35b: but a test holding the lever is still in the cockpit', stovlExt.key(sim, 'KeyT', true, {}) === true && ctl.mode !== 'off');
  stovlExt.key(sim, 'KeyT', false, {});
  stovlExt.stop(sim, 'menu');
  // The same override in the air is a test flying the jet, not a walk.
  ac.reset({ pos: new THREE.Vector3(-470, 0, 0), headingDeg: 90, speed: 0, altAGL: 20, engineOn: true, gearDown: true });
  sim.override = PARK;
  ok('f35b: controls held shut in the air still count as in the cockpit', !ac.onGround && stovlExt.key(sim, 'KeyT', true, {}) === true && ctl.mode === 'hover',
    `onGround ${ac.onGround}, hover ${ctl.mode}`);
  stovlExt.key(sim, 'KeyT', false, {});
  sim.override = null;
  stovlExt.stop(sim, 'menu');
}
{
  // The extension's key: T is the F-35B's, and nobody else's.
  const stovl = Ext.extensions().find((e) => e.id === 'stovl');
  ok('the stovl feature registers itself', !!stovl);
  if (stovl) {
    P.applyAircraft('vanguard');
    const other = { state: 'flying', aircraftType: getAircraft('vanguard'), aircraft: new P.Aircraft() };
    ok('T is not consumed in an aeroplane without STOVL', stovl.key(other, 'KeyT', true, {}) === false);
    P.applyAircraft('f35b');
    const ac = new P.Aircraft();
    ac.reset({ pos: new THREE.Vector3(0, 0, 0), headingDeg: 90, engineOn: true });
    const sim = { state: 'flying', aircraftType: getAircraft('f35b'), aircraft: ac };
    ok('T is consumed in the F-35B and turns the hover on', stovl.key(sim, 'KeyT', true, {}) === true && Stovl.stovlState().mode === 'hover');
    ok('holding T down does not flicker it', stovl.key(sim, 'KeyT', true, { repeat: true }) === true && Stovl.stovlState().mode === 'hover');
    stovl.stop(sim, 'menu');
    ok('stopping the flight switches the hover off and gives SPEC back', Stovl.stovlState().mode === 'off' && P.SPEC.thrustMax === getAircraft('f35b').aero.thrustMax);
  }
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} fighters checks passed`);
if (failed.length) process.exit(1);

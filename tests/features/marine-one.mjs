/**
 * MARINE ONE IN NODE — the presidential VH-3D Sea King (aircraft/extra/helis.js
 * 'vh3d', drawn by models/helis.js buildVH3D), checked headless:
 *
 *   node tests/features/marine-one.mjs
 *
 *   1. The roster and the gate: a Helicopter under the Helicopters heading
 *      and shelf, the Sea King's published numbers, and gated exactly as Air
 *      Force One's 747 is — bought in the hangar for credits, not military,
 *      never one of the free types.
 *   2. The paint: its own fixed scheme whatever livery is picked (as the
 *      President's 747 only ever wears the Air Force One paint), white top
 *      over dark green, the title, never handed out at random, and nothing
 *      of a real seal anywhere in it — a star roundel of the game's own.
 *   3. The model: its own airframe, five blades over a five-blade tail
 *      rotor, the title and the roundel on both sides, on its wheels.
 *   4. Spawning: on a helipad wherever the Skyhook gets one, never the
 *      runway fallback.
 *   5. Flying from the pad: lifts into a hover hands off, holds it, and an
 *      engine failure from a cruise is an autorotation to a landing.
 *   6. Never a target: the heat-seekers will not lock it, by name or type.
 */
globalThis.document = globalThis.document || {
  createElement: () => ({
    getContext: () => new Proxy({}, { get: () => () => ({ addColorStop() {}, data: new Uint8ClampedArray(4) }) }),
    width: 0,
    height: 0,
    style: {},
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
const LIV = await import(SRC + 'aircraft/liveries.js');
const { createAircraftModel } = await import(SRC + 'aircraft/model-adapter.js');
const { HELI_GEOMETRY } = await import(SRC + 'aircraft/extra/helis.js');
const MENU = await import(SRC + 'ui/menus.js');
const SHELF = await import(SRC + 'ui/hangar-shelves.js');
const Prog = await import(SRC + 'game/progression.js');
const HSR = await import(SRC + 'features/heatseek/rules.js');
const TR = await import(SRC + 'world/terrain.js');
const AP = await import(SRC + 'world/airport.js');
const APR = await import(SRC + 'world/apron.js');
const AL = await import(SRC + 'world/airport-layout.js');
const PD = await import(SRC + 'world/pads.js');
const { MAPS } = await import(SRC + 'world/maps.js');
const SP = await import(SRC + 'world/spawns.js');

let passed = 0;
let failed = 0;
function ok(name, pass, detail = '') {
  if (pass) passed++;
  else failed++;
  console.log(`${pass ? 'ok  ' : 'FAIL'} ${name}${detail !== '' ? ` — ${detail}` : ''}`);
}
const f1 = (v) => (Number.isFinite(v) ? v.toFixed(1) : String(v));
const f2 = (v) => (Number.isFinite(v) ? v.toFixed(2) : String(v));
const KT = 1.94384;

const ID = 'vh3d';
const t = T.getAircraft(ID);
const spec = T.specFor(ID);
const Gm = HELI_GEOMETRY[ID];

/* ------------------------------------------------------------------ *
 * 1. The roster and the gate
 * ------------------------------------------------------------------ */
console.log('\n--- the roster and the gate ---');
ok('Marine One is in the roster', !!t && t.id === ID && t.name === 'Marine One', t && t.name);
ok('a Helicopter: class, isHelicopter, the rotor, the Helicopters heading and shelf, the heli spawn class',
  t.class === 'Helicopter' && T.isHelicopter(t) && spec.rotor === true && MENU.aircraftCategory(t) === 'helicopter'
  && SHELF.shelfOf(t, MENU.aircraftCategory) === 'helicopters' && SP.spawnClassOf(t) === 'heli',
  `${MENU.aircraftCategory(t)} / ${SHELF.shelfOf(t, MENU.aircraftCategory)}`);
ok(`the Sea King's rotor: 18.9 m, five blades, 203 rpm (${spec.rotorRadius * 2} m, ${spec.rotorBlades}, ${f1(spec.rotorHz * 60)} rpm)`,
  Math.abs(spec.rotorRadius - 9.45) < 1e-6 && spec.rotorBlades === 5 && Math.abs(spec.rotorHz * 60 - 203) < 1);
ok(`the Sea King's numbers: 144 kt red line, 14,700 ft ceiling, 8.2 t (${f1(spec.vne * KT)} kt, ${spec.ceiling} ft, ${spec.mass} kg)`,
  Math.abs(spec.vne * KT - 144) < 1 && spec.ceiling === 14700 && spec.mass > 5382 && spec.mass < 9752);
const b747 = T.getAircraft('b747');
const fresh = () => ({ credits: 0, earned: 0, devUnlocked: false, unlocked: ['skylark', 'courier', 'harrier'], redeemed: [], best: [] });
ok('gated as Air Force One\'s 747 is: not military, for sale for credits',
  !t.military && !b747.military && !Prog.isUnlocked(fresh(), ID) && !Prog.isUnlocked(fresh(), 'b747')
  && Prog.costOf(ID) > 0 && Prog.costOf('b747') > 0 && Prog.UNLOCKS.some((u) => u.aircraft === ID && !u.military),
  `${Prog.costOf(ID)} credits (the 747: ${Prog.costOf('b747')})`);
{
  const p = fresh();
  const shut = !Prog.isUnlocked(p, ID) && !Prog.buy(p, ID).ok;
  p.credits = Prog.costOf(ID);
  const bought = Prog.buy(p, ID);
  ok('not yours at the start; bought with enough credits, and then yours', shut && bought.ok && Prog.isUnlocked(p, ID) && p.credits === 0);
}
ok('the hangar card quotes it', (() => { const pf = T.performanceFor(ID); return pf.vne > 100 && pf.enduranceMin > 60; })());

/* ------------------------------------------------------------------ *
 * 2. The paint
 * ------------------------------------------------------------------ */
console.log('\n--- the paint ---');
const sch = LIV.schemeFor(t, 'house');
ok('its own fixed scheme, whatever livery the game is set to',
  LIV.LIVERIES.every((l) => LIV.schemeFor(t, l.id) === sch) && sch.id === 'marine-one' && t.fixedLivery === 'marine-one', sch.id);
ok('the hangar shows that one paint and no other', LIV.liveriesFor(t).length === 1 && LIV.liveriesFor(t)[0] === sch && LIV.liveriesFor(b747) === LIV.LIVERIES);
const lum = (hex) => { const c = new THREE.Color(hex); return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b; };
const green = new THREE.Color(sch.base);
ok(`white top (${sch.upper}) over dark green (${sch.base})`, lum(sch.upper) > 0.8 && lum(sch.base) < 0.05 && green.g >= green.r && green.g >= green.b);
ok('the title the real one wears', sch.title === 'UNITED STATES OF AMERICA');
ok('never handed out at random: not an airline scheme, not in the Settings list, not on an apron',
  !LIV.LIVERIES.includes(sch) && !LIV.AIRLINE_LIVERIES.includes(sch) && !LIV.wearsAirlinePaint(t) && sch.special === true);
ok('no other type can wear it, even asked by id (a 747 asked for it gets its own house colours)', LIV.schemeFor(b747, 'marine-one').id === 'house' && LIV.schemeFor(T.getAircraft('uh60'), 'marine-one').id === 'house' && LIV.findLivery('marine-one') === sch);
{
  const text = ['aircraft/models/helis.js', 'aircraft/liveries.js', 'render/textures.js']
    .map((f) => readFileSync(new URL(SRC + f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')).join('\n');
  ok('no seal and no eagle drawn anywhere: the roundel is a star of our own', !/\bseal\b|eagle|presidential seal/i.test(text) && /starRoundelTexture/.test(text));
}

/* ------------------------------------------------------------------ *
 * 3. The model
 * ------------------------------------------------------------------ */
console.log('\n--- the model ---');
const REST = { controls: { pitch: 0, roll: 0, yaw: 0, throttle: 0, brakes: 1 }, rpm: 0, flaps: 0, gearPos: 1, gearDown: true, onGround: true, groundSpeed: 0, agl: 0, engineOn: false };
const model = createAircraftModel({ type: t, livery: LIV.schemeFor(t, 'kanal') });
model.userData.update(0.016, REST, { isNight: false, cond: { cloud: 0 } });
const parts = model.userData.parts;
ok('drawn by its own airframe (models/helis.js), not the generic factory', model.userData.civil === ID);
ok('five main blades and a five-blade tail rotor on the left of the pylon',
  parts.rotors.length === 1 && parts.rotors[0].coners.length === 5 && parts.rotors[0].tailCount === 5
  && model.getObjectByName('tail rotor').position.x < 0, `${parts.rotors[0].coners.length} / ${parts.rotors[0].tailCount}`);
const title = model.getObjectByName('Titling');
ok('the title is painted on, both sides, in white', !!title && title.material.map.userData.text === 'UNITED STATES OF AMERICA' && lum(sch.cheatline) > 0.8);
ok('the star roundel is on both sides', !!model.getObjectByName('Star roundel'));
{
  const box = new THREE.Box3().setFromObject(model);
  const low = Math.min(...spec.gearPoints.map((g) => g.pos.y));
  ok(`it stands on its wheels (lowest drawn point ${f2(box.min.y)} m, contact ${f2(low)} m)`, Math.abs(box.min.y - low) < 0.06);
  let tris = 0;
  let meshes = 0;
  model.traverse((o) => {
    if (o.isMesh) { meshes++; tris += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3; }
  });
  ok(`cheap enough for a Chromebook (${Math.round(tris)} triangles, ${meshes} meshes)`, tris < 12000 && meshes < 40);
}
{
  /*
   * The sponsons stand out of the hull on BOTH sides (models/helis.js pods()).
   * Batch.place moves the geometry it is handed, so one pod geometry put on
   * each side went left and then straight back to the centreline: no
   * sponsons on the Sea King, the AW139 or the Chinook, no Apache cheeks.
   * Measured as the airframe's widest point beside the hull's, both sides.
   */
  const reach = (id) => {
    const ty = T.getAircraft(id);
    const m = createAircraftModel({ type: ty, livery: LIV.schemeFor(ty, 'house') });
    m.updateMatrixWorld(true);
    const hullBox = new THREE.Box3().setFromObject(m.getObjectByName('fuselage'));
    const air = new THREE.Box3();
    m.traverse((o) => { if (o.isMesh && /airframe$/.test(o.name)) air.union(new THREE.Box3().setFromObject(o)); });
    return { l: hullBox.min.x - air.min.x, r: air.max.x - hullBox.max.x };
  };
  for (const [id, need] of [[ID, 0.4], ['ch47', 0.38]]) {
    const g = reach(id);
    ok(`${id}: the sponsons stand out of the hull on both sides (${f2(g.l)} / ${f2(g.r)} m)`, g.l > need && g.r > need);
  }
}

/* ------------------------------------------------------------------ *
 * 4. Spawning
 * ------------------------------------------------------------------ */
console.log('\n--- spawning ---');
function loadMap(id) {
  TR.applyMap(id);
  AP.refreshRunways();
  APR.refreshApronElevation();
  TR.clearObstacles();
  TR.clearPlatforms();
  const scene = { add() {} };
  new AP.Airport(scene);
  new APR.Apron(scene, 'high');
  PD.buildPads(new THREE.Group());
}
let padMaps = 0;
const misses = [];
let kestrelPad = null;
for (const m of MAPS) {
  loadMap(m.id);
  const ctx = { layout: AL.airportLayout(), traffic: [] };
  const sky = SP.resolveSpawn(m.id, 'heli', { type: T.getAircraft('harrier'), ctx });
  if (sky.kind !== 'pad') continue;
  const r = SP.resolveSpawn(m.id, 'heli', { type: t, ctx });
  if (r.kind === 'pad' && !r.fallback) padMaps++;
  else misses.push(`${m.id}: ${r.kind} ${r.label}`);
  if (m.id === 'kestrel') kestrelPad = r;
}
ok(`on a helipad on every map where the Skyhook gets one (${padMaps})`, padMaps >= 10 && misses.length === 0, misses.join('; '));

/* ------------------------------------------------------------------ *
 * 5. Flying from the pad
 * ------------------------------------------------------------------ */
console.log('\n--- flying from the pad ---');
loadMap('kestrel');
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
const STEP = 1 / 120;
function spawnOnPad() {
  P.applyAircraft(ID);
  const ac = new P.Aircraft();
  ac.mode = 'simplified';
  ac.difficulty = 'normal';
  ac.hoverAssist = true;
  ac.reset({ pos: new THREE.Vector3(kestrelPad.x, 0, kestrelPad.z), headingDeg: kestrelPad.headingDeg, engineOn: true });
  ac.settleOnGear();
  weather.time_s = 0;
  return ac;
}
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
function liftTo(ac, p, h) {
  p.held = true;
  p.step(40, () => {
    const vs = Math.max(0, ac.vs);
    const stop = skidH(ac) + (vs * vs) / 6 + vs * 0.3 > h;
    if (!stop) p.lever = Math.min(1, p.lever + 0.62 * STEP);
    return stop;
  });
  p.held = false;
  p.step(8);
}
{
  const ac = spawnOnPad();
  const p = pilot(ac);
  const from = ac.pos.clone();
  p.step(3);
  ok(`on the Kestrel pad (${kestrelPad.label}) it stands still on its wheels`, ac.onGround && !ac.crashed && ac.pos.distanceTo(from) < 0.3, `moved ${f2(ac.pos.distanceTo(from))} m`);
  liftTo(ac, p, 20);
  const h0 = skidH(ac);
  const pos0 = ac.pos.clone();
  p.step(8);
  ok(`lifts off the pad to a hover at ${f1(h0)} m and holds it hands off (vs ${f2(ac.vs)}, drift ${f2(ac.pos.distanceTo(pos0))} m in 8 s)`,
    !ac.crashed && !ac.onGround && h0 > 10 && h0 < 35 && Math.abs(ac.vs) < 0.6 && ac.pos.distanceTo(pos0) < 6);
}
{
  const ac = spawnOnPad();
  const p = pilot(ac);
  liftTo(ac, p, 160);
  p.step(40, () => {
    p.pitch = ac.groundSpeed < 25 ? -0.6 : 0;
    return ac.groundSpeed >= 25;
  });
  p.pitch = 0;
  p.step(3);
  const hFail = skidH(ac);
  ac.failures.engine = true;
  let sawAuto = false;
  let touchVs = 0;
  let nrMin = 2;
  p.step(120, () => {
    if (ac.onGround) return true;
    if (!ac.engineOn) {
      sawAuto = sawAuto || !!ac.rotor.autorotating;
      nrMin = Math.min(nrMin, ac.rotor.nr);
      touchVs = ac.vs;
    }
    return false;
  });
  const td = ac.lastTouchdown || {};
  ok(`engine out at ${f1(hFail)} m: autorotates to a landing (touched at ${f1(Math.abs(touchVs))} m/s, ${td.quality || '?'}, NR never under ${f2(nrMin)})`,
    sawAuto && !ac.crashed && ac.onGround && Math.abs(touchVs) < 4.6 && nrMin > 0.6, `crashed ${ac.crashed} ${ac.crashReason || ''}`);
}

/* ------------------------------------------------------------------ *
 * 6. Never a target
 * ------------------------------------------------------------------ */
console.log('\n--- never a target ---');
ok('the heat-seekers will not lock it, by type or by name, PvP or not',
  !HSR.targetVerdict({ typeId: ID, kind: 'player', pvpLive: true }, { pvp: true }).ok
  && !HSR.targetVerdict({ name: 'Marine One', kind: 'drone' }, {}).ok);
ok('...the same as Air Force One', !HSR.targetVerdict({ typeId: 'b747', kind: 'player', pvpLive: true }, { pvp: true }).ok);

/* ------------------------------------------------------------------ *
 * 7. On a friend's screen (multiplayer/remotes.js)
 * ------------------------------------------------------------------ */
console.log('\n--- on a friend\'s screen ---');
{
  const { Remotes } = await import(SRC + 'features/multiplayer/remotes.js');
  const rem = new Remotes();
  // Whatever paint the pilot has picked for everything else, or none heard at all.
  const built = ['', 'house', 'potus', 'kanal'].map((paint) => {
    let model = null;
    let err = '';
    try { model = rem._build('air', ID, '#58c6ff', paint); } catch (e) { err = String(e && e.message); }
    return { paint, model, err };
  });
  ok('a remote Marine One builds whatever paint its pilot has picked', built.every((b) => b.model && !b.err), built.map((b) => b.err).filter(Boolean).join('; '));
  // The remote is painted in its own scheme: the titling is only drawn for a scheme that has one, and
  // neither the player colour ('' / 'house') nor an airline ('kanal') does.
  const titled = (m) => { let n = 0; m.traverse((o) => { if (o.name === 'Titling') n++; }); return n; };
  ok('...and is painted in its own scheme (the title on it), not the player colour or the pilot\'s other paint',
    built.every((x) => x.model && titled(x.model) > 0), built.map((x) => `${x.paint || 'none'}:${x.model ? titled(x.model) : '-'}`).join(' '));
}

console.log(`\nmarine-one: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);

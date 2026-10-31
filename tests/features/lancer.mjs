/**
 * The B-1B Lancer (owner, 2026-10-16: "also note: add b1 lancers"), checked
 * in node against the real roster, the real model factory and the real
 * flight model — with the swing wing (src/aircraft/swing-wing.js) put on the
 * Aircraft exactly as src/features/swing-wing.js puts it on in the game, so
 * every distance and speed here is what the game flies.
 *
 *   node tests/features/lancer.mjs
 *
 * Exits non-zero if anything fails. What it holds:
 *   - the roster entry: military, bought for credits, unarmed, never on the
 *     carrier, for sale, a jet with JetSound and a yaw damper, real spans;
 *   - the project's aircraft rules: sized to the runway (it flies from the
 *     1,100 m Kestrel strip with the wing forward), gear stiffness scales
 *     with mass, spawn height from its own gear, the cockpit from its eye;
 *   - the model: the fleet pack's, real proportions, the wing panels turning
 *     on their pins to the published swept span with the tip lamps on them,
 *     a remote player's sweeping by itself, every paint scheme;
 *   - the swing wing: AUTO sweeps with speed and comes forward for the
 *     flaps, the keys' notches, the flaps waiting for the wing, the advice;
 *   - the afterburners and the sound barrier: Mach 1.2 and more at 40,000 ft
 *     with the wing back, never past the inlets' 1.25, held under Mach 0.85
 *     with it forward, the dash down low under the red line;
 *   - the wrapper leaves SPEC exactly as it found it, every step, and a fault
 *     inside it switches it off without stopping the aeroplane.
 */

global.document = {
  createElement: () => ({
    getContext: () => new Proxy({}, { get: () => () => ({ addColorStop() {}, data: new Uint8ClampedArray(4) }) }),
    width: 0, height: 0, style: {}, appendChild() {}, classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    addEventListener() {}, querySelector: () => null, querySelectorAll: () => [], setAttribute() {},
  }),
  body: { appendChild() {}, classList: { toggle() {} } },
  head: { appendChild() {} },
};
globalThis.window = globalThis.window || { addEventListener() {}, devicePixelRatio: 1 };
globalThis.localStorage = globalThis.localStorage || { getItem: () => null, setItem() {}, removeItem() {} };

const SRC = new URL('../../src/', import.meta.url).href;
const THREE = await import(SRC + 'vendor/three.module.js');
const T = await import(SRC + 'aircraft/types.js');
const P = await import(SRC + 'aircraft/physics.js');
const TER = await import(SRC + 'world/terrain.js');
const L = await import(SRC + 'aircraft/extra/lancer.js');
const SW = await import(SRC + 'aircraft/swing-wing.js');
const PROG = await import(SRC + 'game/progression.js');
const { circuitPilot } = await import(new URL('./circuit-pilot.js', import.meta.url).href);

const KT = 1.94384;
const FT = 3.28084;
const DEG = 180 / Math.PI;
const ID = 'b1b';
const G = L.LANCER_GEOMETRY;

let failed = 0;
let passed = 0;
const fails = [];
function ok(name, pass, detail = '') {
  if (pass) passed++;
  else {
    failed++;
    fails.push(name);
  }
  console.log(`${pass ? 'ok  ' : 'FAIL'} ${name}${detail !== '' ? ` — ${detail}` : ''}`);
}
const info = (s) => console.log(`INFO ${s}`);
const r2 = (v) => +(+v).toFixed(2);

/* ------------------------------------------------------------------ *
 * The roster
 * ------------------------------------------------------------------ */
const t = T.AIRCRAFT.find((a) => a.id === ID);
ok('b1b: in AIRCRAFT', !!t);
const a = t.aero;
const W = a.mass * 9.80665;
{
  ok('b1b: military by category and flag, filed under Military, bought for credits like the rest (no passcode)',
    t.category === 'military' && t.military === true && t.price > 0 && typeof PROG.needsPasscode === 'undefined');
  ok('b1b: a swing wing, unarmed, never on the carrier', t.swingWing === true && t.unarmed === true && t.carrier === false);
  ok('b1b: named, described (the keys in the blurb), a callsign, stats as pips',
    t.name === 'B-1B Lancer' && /\]/.test(t.blurb) && /\[/.test(t.blurb) && t.blurb.length > 80 && !!t.callsign
    && ['speed', 'handling', 'ease'].every((k) => Number.isInteger(t.stats[k]) && t.stats[k] >= 1 && t.stats[k] <= 5));
  ok("b1b: no maker's logo or trademark words in the text", !/logo|™|®|rockwell|boeing|usaf|air force/i.test(`${t.name} ${t.blurb} ${t.callsign}`));
  ok('b1b: every aero number finite', Object.values(a).filter((v) => typeof v === 'number').every(Number.isFinite));
  ok('b1b: undercarriage can hold it (mass < 32 t)', a.mass > 10000 && a.mass < 32000, `${a.mass} kg`);
  ok('b1b: thrust-to-weight 0.3-0.5 (full power, burners included)', a.thrustMax / W > 0.3 && a.thrustMax / W < 0.5, (a.thrustMax / W).toFixed(2));
  ok('b1b: wing loading 150-260 kg/m2', a.mass / a.wingArea > 150 && a.mass / a.wingArea < 260, (a.mass / a.wingArea).toFixed(0));
  ok('b1b: the real spans, forward and swept (41.67 m, 23.84 m)', Math.abs(G.spanSpread - 41.67) < 0.1 && Math.abs(G.spanSwept - 23.84) < 0.1 && Math.abs(a.wingSpan - 41.67) < 0.1,
    `${G.spanSpread} m, ${G.spanSwept} m`);
  ok('b1b: inertias positive, yaw the largest', a.Ixx > 0 && a.Izz > 0 && a.Iyy >= Math.max(a.Ixx, a.Izz));
  const perf = T.performanceFor(ID);
  ok('b1b: approach speed (wing forward, full flap) 60-82 kt: the approach (x 1.3) well under the 120 kt touchdown limit', perf.stallLanding >= 60 && perf.stallLanding <= 82, `${perf.stallLanding} kt`);
  const massimo = T.performanceFor('massimo');
  ok('b1b: its red line under Air Massimo\'s (Massimo keeps the hangar\'s top "Top")', perf.vne < massimo.vne && a.vne < T.getAircraft('massimo').aero.vne, `${perf.vne} kt vs ${massimo.vne}`);
  ok('b1b: long range (over 2 h at full power without the burners)', perf.enduranceMin > 120, `${perf.enduranceMin} min`);
  const spec = T.specFor(ID);
  ok('b1b: a jet — JetSound (power.kind jet), a yaw damper, no propeller, four engines with burners',
    t.shape.power.kind === 'jet' && spec.yawDamper === true && spec.propeller === false && spec.rotor === false && t.shape.power.count === 4 && t.shape.power.afterburner === true);
  // Gear stiffness scales with mass: the static deflection of the mains is a sane fraction of their travel.
  const legs = spec.gearPoints;
  const defl = W / legs.reduce((s, g) => s + g.k, 0);
  const frac = defl / legs[1].travel;
  ok(`b1b: gear stiffness scales with mass (static sag ${(frac * 100).toFixed(0)}% of travel)`, frac > 0.05 && frac < 0.8);
  // The physics tail strikes no later than the drawing, and well past the stall guard.
  const mainPt = spec.gearPoints.find((p) => p.name === 'right').pos;
  const tailPt = spec.hardPoints.find((h) => h.part === 'tail').pos;
  const phys = Math.atan2(tailPt.y - mainPt.y, tailPt.z - mainPt.z) * DEG;
  const guard = (a.alphaStall - 0.045) * DEG;
  ok(`b1b: the physics tail strikes just before the drawn one (${G.strike.deg.toFixed(2)} deg), 2.2 deg past the stall guard (${guard.toFixed(1)})`,
    phys <= G.strike.deg + 0.05 && phys > G.strike.deg - 0.6 && phys - guard >= 2.2, `physics ${phys.toFixed(2)} deg`);
  ok('b1b: main contact where the geometry puts it', Math.abs(mainPt.x - G.main.x) < 0.01 && Math.abs(mainPt.y - G.ground) < 0.01 && Math.abs(mainPt.z - G.main.z) < 0.01);
  ok("b1b: the airfield's plan is the wing-forward drawing (nose, tail, span)", t.plan.nose === G.noseZ && t.plan.tail === G.tailZ && Math.abs(t.plan.span - G.spanSpread) < 1e-6);
}

/* ------------------------------------------------------------------ *
 * The swing wing's numbers
 * ------------------------------------------------------------------ */
{
  const n15 = L.sweptNumbers(a, 15);
  const n67 = L.sweptNumbers(a, 67.5);
  ok('sweep: at the forward stop the numbers are the roster\'s, untouched', Object.entries(n15).every(([k, v]) => Math.abs(v - a[k]) < 1e-9));
  const keys = ['CLa', 'CL0', 'CD0', 'Clda', 'Izz', 'wingSpan'];
  let mono = true;
  let prev = null;
  for (let d = 15; d <= 67.5; d += 2.5) {
    const n = L.sweptNumbers(a, d);
    if (prev) for (const k of keys) if (n[k] > prev[k] + 1e-9) mono = false;
    if (prev && (n.k < prev.k - 1e-9 || n.alphaStall < prev.alphaStall - 1e-9)) mono = false;
    prev = n;
  }
  ok('sweep: back is less lift per degree, less camber, less span, roll power and roll inertia; more drag due to lift; a later stall — all the way', mono);
  ok('sweep: drag due to lift goes as 1/aspect ratio (x3 at full sweep)', Math.abs(n67.k / a.k - (41.67 / 23.84) ** 2) < 0.05, (n67.k / a.k).toFixed(2));
  // The tip moves along an arc about the pin.
  const pin = L.LANCER_WING.pivot;
  const r15 = Math.hypot(L.tipAt(15).x - pin.x, L.tipAt(15).z - pin.z);
  const r67 = Math.hypot(L.tipAt(67.5).x - pin.x, L.tipAt(67.5).z - pin.z);
  ok('sweep: the tip turns about the pin (same radius forward and back) and goes aft', Math.abs(r15 - r67) < 1e-6 && L.tipAt(67.5).z > L.tipAt(15).z + 8);
  // The transonic drag rise: a wall for the straight wing, a step for the swept one.
  const w15 = L.waveDrag(0.85, 15);
  const w67 = L.waveDrag(0.85, 67.5);
  ok('wave drag: at Mach 0.85 the forward wing has many times the swept wing\'s', w15 > 0.03 && w67 < 0.002, `${w15.toFixed(4)} vs ${w67.toFixed(4)}`);
  ok('wave drag: none below Mach 0.6 at any sweep', [15, 25, 45, 67.5].every((d) => L.waveDrag(0.6, d) === 0));
  ok('wave drag: the inlets choke past Mach 1.22 — it climbs steeply', L.waveDrag(1.3, 67.5) > L.waveDrag(1.2, 67.5) * 2);
  // The air.
  ok('the speed of sound: 340 m/s at sea level, 295 from 11 km up (ISA)', Math.abs(L.speedOfSound(0) - 340.3) < 0.5 && Math.abs(L.speedOfSound(12000) - 295.1) < 0.5 && L.speedOfSound(15000) === L.speedOfSound(11000));
  // The automatic schedule.
  const A = (o) => L.autoSweep(o);
  ok('AUTO: forward with the flaps or the wheels down, whatever the speed', A({ M: 0.8, iasKt: 400, flaps: 0.33 }) === 15 && A({ M: 0.8, iasKt: 400, gearDown: true }) === 15);
  ok('AUTO: forward for slow flight, 25 in the climb, all the way back for the dash and past Mach 0.9',
    A({ M: 0.3, iasKt: 180 }) === 15 && Math.abs(A({ M: 0.62, iasKt: 245 }) - 25) < 3 && A({ M: 0.92, iasKt: 300 }) === 67.5 && A({ M: 0.75, iasKt: 470 }) === 67.5);
  ok('AUTO: never more sweep than 1.4 x the swept stall allows', A({ M: 0.95, iasKt: 120 }) === 15);
  // The burners.
  ok('burners: dry below 85% throttle (every jet\'s thrust law), lit above', L.thrustScale({ throttle: 0.8, u: 200, M: 0.6, sigma: 0.5 }) === 1 && L.thrustScale({ throttle: 1, u: 200, M: 0.6, sigma: 0.5 }) > 4);
  ok('idle: a third of the shared law\'s 18% at idle, all of it again by 35% throttle (the approach)', Math.abs(L.thrustScale({ throttle: 0, u: 0, M: 0, sigma: 1 }) - 0.35) < 1e-9 && L.thrustScale({ throttle: 0.35, u: 60, M: 0.2, sigma: 1 }) === 1);
}

/* ------------------------------------------------------------------ *
 * The model, through the factory main.js calls
 * ------------------------------------------------------------------ */
const ADAPTER = await import(SRC + 'aircraft/model-adapter.js');
const LIV = await import(SRC + 'aircraft/liveries.js');
const KIT = await import(SRC + 'fleet/extra/airliner-kit.js');
const MENUS = await import(SRC + 'ui/menus.js').catch(() => null);
const EJECT = await import(SRC + 'features/eject/profiles.js');
const HEAT = await import(SRC + 'features/heatseek/rules.js');
const GUNS = await import(SRC + 'features/gunsight/rules.js');
const WHO = await import(SRC + 'features/carrier/who.js');
const PROTO = await import(SRC + 'features/multiplayer/protocol.js');

function stats(model) {
  model.updateMatrixWorld(true);
  let tris = 0;
  let bad = 0;
  let verts = 0;
  let tyres = 0;
  const m4 = new THREE.Matrix4();
  model.traverse((o) => {
    if (o.isMesh && o.geometry) {
      const g = o.geometry;
      tris += ((g.index ? g.index.count : g.attributes.position.count) / 3) * (o.isInstancedMesh ? o.count : 1);
      for (const v of g.attributes.position.array) if (!Number.isFinite(v)) bad++;
      verts += g.attributes.position.count;
    }
    if (o.isInstancedMesh) {
      for (let k = 0; k < o.count; k++) {
        o.getMatrixAt(k, m4);
        if (!m4.elements.every(Number.isFinite)) bad++;
      }
      if (/tyre/i.test(o.name)) tyres += o.count;
    }
  });
  return { tris, bad, verts, tyres };
}
/** Every vertex (instances included) in the model's frame, with the part it hangs from. */
function points(model, skip = /gear|engine|propulsion/i) {
  model.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(model.matrixWorld).invert();
  const out = [];
  const v = new THREE.Vector3();
  const im = new THREE.Matrix4();
  model.traverseVisible((o) => {
    if (!o.isMesh || o.isSprite || !o.geometry) return;
    for (let p = o; p; p = p.parent) if (skip && skip.test(p.name)) return;
    const pos = o.geometry.attributes.position;
    for (let k = 0, n = o.isInstancedMesh ? o.count : 1; k < n; k++) {
      if (o.isInstancedMesh) o.getMatrixAt(k, im);
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i);
        if (o.isInstancedMesh) v.applyMatrix4(im);
        v.applyMatrix4(o.matrixWorld).applyMatrix4(inv);
        out.push([v.x, v.y, v.z]);
      }
    }
  });
  return out;
}
const extent = (pts) => {
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity, y0 = Infinity;
  for (const [x, y, z] of pts) {
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (z < z0) z0 = z;
    if (z > z1) z1 = z;
    if (y < y0) y0 = y;
  }
  return { x0, x1, z0, z1, y0 };
};

{
  const type = T.getAircraft(ID);
  const model = ADAPTER.createAircraftModel({ type, livery: LIV.schemeFor(type, 'house') });
  ok('b1b: drawn by the fleet pack (DRAWS), not the fallback', !!model.userData.fleetBridge && ADAPTER.fleetCovers(ID) && model.userData.aircraftId === ID, ADAPTER.fleetStatus().error || '');
  const st = stats(model);
  ok('b1b: zero NaN vertices or instance matrices', st.bad === 0 && st.verts > 1000, `${st.bad} bad of ${st.verts}`);
  ok('b1b: under 15,000 triangles', st.tris < 15000, `${Math.round(st.tris)}`);
  const fg = model.userData.flightGeometry;
  const b = fg.bounds;
  const span = b.max[0] - b.min[0];
  const length = b.max[2] - b.min[2];
  ok('b1b: span (wing forward) within 2% of the real 41.67 m', Math.abs(span / 41.67 - 1) < 0.02, `${span.toFixed(2)} m`);
  ok('b1b: length within 2% of the real 44.5 m', Math.abs(length / 44.5 - 1) < 0.02, `${length.toFixed(2)} m`);
  ok('b1b: height within 3% of the real 10.4 m', Math.abs((b.max[1] - G.ground) / 10.4 - 1) < 0.03, `${(b.max[1] - G.ground).toFixed(2)} m`);
  ok("b1b: the airfield's plan is the drawing's, to half a metre",
    Math.abs(type.plan.nose - b.min[2]) < 0.5 && Math.abs(type.plan.tail - b.max[2]) < 0.5 && Math.abs(type.plan.span - span) < 0.5);
  const spec = T.specFor(ID);
  const off = ADAPTER.groundOffsetFor(model, spec);
  ok('b1b: drawn tyres meet the physics contact points', Math.abs(off) < 0.03, `${off.toFixed(3)} m`);
  ok('b1b: three undercarriage legs the core animates, ten tyres (twin nose, two four-wheel bogies)', model.userData.parts.gear.length === 3 && st.tyres === 10, `${model.userData.parts.gear.length} legs, ${st.tyres} tyres`);
  ok('b1b: four engines, each its own breakaway group', model.userData.parts.engines.length === 4 && ['leftInboardEngine', 'leftOutboardEngine', 'rightInboardEngine', 'rightOutboardEngine'].every((k) => !!model.userData.parts[k]));
  const low = extent(points(model)).y0;
  ok('b1b: no part of the airframe below the wheels', low > G.ground + 0.2, `${r2(low)} m vs ground ${G.ground}`);
  const nac = extent(points(model, /gear/i)).y0;
  ok('b1b: the nacelles clear the runway by more than half a metre', nac > G.ground + 0.5, `${r2(nac - G.ground)} m`);
  // Tail strike, measured off the drawing.
  const mainPt = spec.gearPoints.find((p) => p.name === 'right').pos;
  const tailPt = spec.hardPoints.find((h) => h.part === 'tail').pos;
  const phys = Math.atan2(tailPt.y - mainPt.y, tailPt.z - mainPt.z) * DEG;
  let drawn = 90;
  for (const [, y, z] of points(model, /gear/i)) {
    if (z < mainPt.z + 2) continue;
    drawn = Math.min(drawn, Math.atan2(y - mainPt.y, z - mainPt.z) * DEG);
  }
  ok('b1b: tail strikes in the physics no later than on the drawing', phys <= drawn + 0.35, `physics ${phys.toFixed(2)} deg, drawn ${drawn.toFixed(2)} deg`);
  // The cockpit is placed from the type's eye: in the flight deck, under its roof, behind the windscreen.
  const eye = fg.eye;
  ok("b1b: the model's eye is the type's eye", eye.every((v, i) => Math.abs(v - G.eye[i]) < 1e-6) && Math.abs(type.shape.eye[2] * type.shape.scale - G.eye[2]) < 0.01);
  ok('b1b: eye 5-9 m behind the nose (behind the long radome)', eye[2] > G.noseZ + 5 && eye[2] < G.noseZ + 9, eye.join(', '));
  {
    const hh = KIT.loftFuselage({ stations: G.stations, radial: 18, maxStep: 1.1, along: (z) => z });
    const roof = hh.topAt(eye[2]) - eye[1];
    ok("b1b: a roof over the pilot's head", roof > 0.3 && roof < 2.2, `${roof.toFixed(2)} m of headroom`);
    ok('b1b: the pilot sits inside the body, not in its skin', Math.abs(eye[0]) < hh.halfWidthAt(eye[2], eye[1]) - 0.3);
  }
  const fd = model.userData.flightDeck;
  const panes = fd ? fd.panes : [];
  const ws = panes.filter((p) => /^Windscreen/.test(p.name));
  const wy = ws.flatMap((p) => p.corners.map((c) => c[1]));
  const wz = ws.flatMap((p) => p.corners.map((c) => c[2]));
  const aft = eye[2] - Math.max(...wz);
  ok('b1b: six panes in frames, the windscreen at the pilot\'s eye height, its glass 0.3-2.2 m ahead',
    panes.length === 6 && ws.length === 2 && Math.min(...wy) < eye[1] && Math.max(...wy) > eye[1] && aft > 0.3 && aft < 2.2,
    `${panes.length} panes, y ${r2(Math.min(...wy))}..${r2(Math.max(...wy))}, eye y ${eye[1]}, glass ${r2(aft)} m ahead`);

  /* The wing moves. */
  const rig = model.userData.sweepRig;
  ok('b1b: the model carries its sweep rig, at rest forward', !!rig && rig.shown === 15);
  const pts = (deg) => {
    rig.sweep = deg;
    model.userData.update(0.05, { rpm: 0.8, gearPos: 0, onGround: false, vel: new THREE.Vector3(0, 0, -200) }, {});
    return extent(points(model, /gear|engine|propulsion|stabil|elevator|aft structure/i));
  };
  const e67 = pts(67.5);
  const e45 = pts(45);
  const e15 = pts(15);
  ok('b1b: swept to 67.5 the drawn span is the real 23.84 m (2%)', Math.abs((e67.x1 - e67.x0) / 23.84 - 1) < 0.02, `${(e67.x1 - e67.x0).toFixed(2)} m`);
  ok('b1b: at 45 it is in between, and back at 15 it is 41.67 again', e45.x1 - e45.x0 < e15.x1 - e15.x0 - 5 && e45.x1 - e45.x0 > e67.x1 - e67.x0 + 5 && Math.abs((e15.x1 - e15.x0) / 41.67 - 1) < 0.02,
    `${(e45.x1 - e45.x0).toFixed(1)} m, ${(e15.x1 - e15.x0).toFixed(1)} m`);
  ok('b1b: nothing of the swept wing reaches past the tail', e67.z1 < G.tailZ, `${r2(e67.z1)} m`);
  // The tip lamps ride on the tips.
  rig.sweep = 67.5;
  model.userData.update(0.05, { rpm: 0.8, gearPos: 0, onGround: false, vel: new THREE.Vector3(0, 0, -200) }, {});
  const nav = model.children.filter((o) => o.isSprite).map((o) => o.position);
  // Where the lamps sit on the tip, relative to the pin at the forward stop (fleet/extra/lancer.js).
  const Wg = L.LANCER_WING;
  const le = -Wg.rootAhead + Wg.span * Math.tan((Wg.min * Math.PI) / 180);
  const want = [L.panelPoint(Wg.span, le + 0.15, 67.5), L.panelPoint(Wg.span, le + Wg.tipChord - 0.15, 67.5)];
  const onTip = nav.filter((p) => want.some((w) => Math.abs(Math.abs(p.x) - w.x) < 0.05 && Math.abs(p.z - w.z) < 0.05));
  ok("b1b: the game's wing-tip lamps (navigation and strobes) follow the swept tips", onTip.length === 4,
    JSON.stringify(nav.map((p) => [r2(p.x), r2(p.z)])));
  // The burners.
  const flames = [];
  model.traverse((o) => { if (/afterburner$/.test(o.name)) flames.push(o); });
  rig.burner = 1;
  model.userData.update(0.05, { rpm: 1, gearPos: 0, onGround: false }, {});
  const lit = flames.filter((f) => f.visible).length;
  rig.burner = 0;
  model.userData.update(0.05, { rpm: 1, gearPos: 0, onGround: false }, {});
  const unlit = flames.filter((f) => f.visible).length;
  ok('b1b: four afterburner flames, shown when the feature says the burners are lit', flames.length === 4 && lit === 4 && unlit === 0, `${flames.length} flames, ${lit} lit, ${unlit} after`);
  // A model nobody drives (a remote player's, the traffic's) sweeps by itself from its speed and wheels.
  rig.sweep = null;
  rig.burner = null;
  for (let i = 0; i < 200; i++) model.userData.update(0.05, { rpm: 1, gearPos: 0, onGround: false, vel: new THREE.Vector3(0, 0, -280) }, {});
  const fast = rig.shown;
  for (let i = 0; i < 200; i++) model.userData.update(0.05, { rpm: 0.4, gearPos: 1, onGround: false, vel: new THREE.Vector3(0, 0, -70) }, {});
  ok('b1b: undriven, it sweeps back at speed and comes forward with the wheels down', fast > 60 && rig.shown === 15, `${fast.toFixed(1)} then ${rig.shown}`);
  let threw = null;
  try {
    for (let i = 0; i < 30; i++) model.userData.update(1 / 30, { rpm: 0.8, gearPos: i < 15 ? 1 : 0.3, onGround: i < 10, controls: { pitch: 0.3, roll: -0.2, yaw: 0.1 }, vel: new THREE.Vector3(0, 0, -60) }, {});
  } catch (e) {
    threw = e;
  }
  ok('b1b: model animates without throwing', !threw, threw ? String(threw) : '');
  model.userData.dispose();

  const failedPaint = [];
  for (const sid of LIV.LIVERIES.map((l) => l.id)) {
    try {
      const m = ADAPTER.createAircraftModel({ type, livery: LIV.schemeFor(type, sid) });
      if (!m.userData.fleetBridge) failedPaint.push(`${sid} (fallback)`);
      m.userData.dispose();
    } catch (e) {
      failedPaint.push(`${sid}: ${e.message}`);
    }
  }
  ok(`b1b: builds in every one of the ${LIV.LIVERIES.length} paint schemes`, failedPaint.length === 0, failedPaint.join('; '));

  // Where the rest of the game files it.
  if (MENUS) ok('b1b: the hangar files it under Military', MENUS.aircraftCategory(type) === 'military', MENUS.aircraftCategory(type));
  const prof = EJECT.profileFor(type);
  ok('b1b: ejection seats for its crew (the eject feature\'s fighter profile)', prof.escape === 'seat', JSON.stringify(prof).slice(0, 120));
  const v = HEAT.targetVerdict({ kind: 'player', typeId: ID, pvpLive: true, name: 'Player' }, { pvp: true });
  ok('b1b: unarmed and never a heat-seeker\'s target, even in PvP', v.ok === false, v.why);
  ok('b1b: no guns, no missiles, no carrier hook', !GUNS.hasGuns(type) && !GUNS.militaryJet(type) && !WHO.isMilitary(type) && !WHO.hasHookFor(type));
  ok('...while the other military jets are as they were', ['f22', 'nightjar', 'fa18'].every((id) => WHO.isMilitary(T.getAircraft(id)) && GUNS.hasGuns(T.getAircraft(id))));
  {
    let built = false;
    try {
      const m = ADAPTER.createAircraftModel({ type, livery: { id: 'multiplayer', name: 'Multiplayer', base: '#3a7bd5', accent: '#ffffff', cheatline: 'rgba(255,255,255,0.9)', tail: 0x3a7bd5, reg: null } });
      built = !!m.userData.fleetBridge && Math.abs(ADAPTER.groundOffsetFor(m, T.specFor(ID))) < 0.03 && !!m.userData.sweepRig;
      m.userData.dispose();
    } catch (e) {
      built = false;
    }
    const wire = PROTO.decodeStates(PROTO.encodeState({ id: 2, seq: 1, t: 0, pos: { x: 1, y: 2, z: 3 }, quat: { w: 1 }, vel: {}, game: 'flight', type: ID }));
    ok("b1b: a multiplayer remote builds it in a player's colour on its wheels, swing wing and all, and the type crosses the wire", built && wire[0] && wire[0].type === ID);
  }
}

/* ------------------------------------------------------------------ *
 * The feature's keys and the hangar row
 * ------------------------------------------------------------------ */
{
  await import(SRC + 'features/swing-wing.js');
  const I = await import(SRC + 'flight/input.js');
  const A = I.ACTIONS;
  ok('keys: wings back ] and forward [ in Flying, in the aeroplane', A.wingsBack && A.wingsForward && A.wingsBack.default[0] === 'BracketRight' && A.wingsForward.default[0] === 'BracketLeft'
    && A.wingsBack.group === 'Flying' && A.wingsBack.ctx.includes('plane'));
  const clash = I.findConflicts(I.defaultBindings());
  ok('keys: no clash in the defaults (sharing [ ] with the hook and the catapult is by design: a Lancer has neither)', !clash.wingsBack && !clash.wingsForward, JSON.stringify(clash).slice(0, 200));
  const cost = PROG.costOf(ID);
  ok('hangar: for sale at its own price, a military row', cost === t.price && cost > 0 && PROG.UNLOCKS.find((u) => u.aircraft === ID).military === true, `${cost} credits`);
  const wallet = { credits: cost, earned: 0, unlocked: ['skylark'], best: [], redeemed: [] };
  const bought = PROG.buy(wallet, ID);
  ok('hangar: buying it unlocks it', bought.ok && PROG.isUnlocked(wallet, ID), JSON.stringify(bought));
}

/* ------------------------------------------------------------------ *
 * Spawns: never the carrier
 * ------------------------------------------------------------------ */
{
  const AP = await import(SRC + 'world/airport.js');
  const APR = await import(SRC + 'world/apron.js');
  const AL = await import(SRC + 'world/airport-layout.js');
  const PD = await import(SRC + 'world/pads.js');
  const SP = await import(SRC + 'world/spawns.js');
  const loadMap = (mid) => {
    TER.applyMap(mid);
    AP.refreshRunways();
    APR.refreshApronElevation();
    TER.clearObstacles();
    TER.clearPlatforms();
    const scene = { add() {} };
    new AP.Airport(scene);
    new APR.Apron(scene, 'high');
    PD.buildPads(new THREE.Group());
  };
  const type = T.getAircraft(ID);
  const f22 = T.getAircraft('f22');
  const carrier = { carrier: { x: 0, z: 9000, headingDeg: 90, deckY: 18 } };
  const lines = [];
  for (const mid of ['kestrel', 'airbase', 'gateway', 'carriergroup']) {
    loadMap(mid);
    const lay = AL.airportLayout();
    const cls = SP.spawnClassOf(type);
    const r = SP.resolveSpawn(mid, cls, { type, ctx: { layout: lay, traffic: [], ...carrier } });
    const finite = [r.x, r.y, r.z, r.headingDeg].every(Number.isFinite);
    const choices = SP.spawnChoices(mid, cls, { type, ctx: { layout: lay, ...carrier } });
    lines.push(`${mid}: ${r.kind} ${r.label}`);
    ok(`${mid}: the military class, a finite start that is not the carrier, and no Carrier in its picker`,
      cls === 'military' && finite && r.kind !== 'carrier' && r.kind !== 'hover' && !choices.some((c) => c.id === 'carrier'), `${r.kind} ${r.label}; picker ${choices.map((c) => c.id).join(',')}`);
    ok(`${mid}: the other military jets' lists are unchanged`, JSON.stringify(SP.candidatesFor(mid, 'military', f22)) === JSON.stringify(SP.candidatesFor(mid, 'military')));
  }
  info(`starts: ${lines.join(' | ')}`);
}

/* ------------------------------------------------------------------ *
 * Flying it — with the swing wing on, as the game flies it
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
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
function gearClearance(ac) {
  let m = Infinity;
  for (const g of P.SPEC.gearPoints) {
    _w.copy(g.pos).applyQuaternion(ac.quat).add(ac.pos);
    m = Math.min(m, _w.y - TER.heightAt(_w.x, _w.z));
  }
  return m;
}
function runwayOf(map = 'kestrel') {
  TER.applyMap(map);
  const r = TER.AIRPORT.runway;
  return { len: r.length, x0: r.cx - r.length / 2, start: r.cx - r.length / 2 + 80, end: r.cx + r.length / 2, elev: TER.heightAt(r.cx, r.cz), z: r.cz, half: r.halfWidth };
}
function make(mode = 'simplified') {
  P.applyAircraft(ID);
  const ac = new P.Aircraft();
  ac.mode = mode;
  const sw = new SW.SwingWing();
  SW.wrapUpdate(ac, sw);
  return { ac, sw };
}
function run(ac, seconds, ctrl, each) {
  for (let f = 0, n = Math.round(seconds * 60); f < n; f++) {
    Object.assign(ac.controls, ctrl);
    ac.update(1 / 120, weather);
    ac.update(1 / 120, weather);
    if (each) each();
    if (ac.crashed) return;
  }
}

/** The playtest's take-off: full power (the burners), the flap the game sets, 0.45 back stick at 1.25 x approach speed, then 10 degrees. */
function takeoff(rw, { mode = 'simplified', flaps = t.takeoffFlaps } = {}) {
  const { ac, sw } = make(mode);
  ac.reset({ pos: new THREE.Vector3(rw.start, rw.elev, rw.z), headingDeg: 90, engineOn: true });
  const vr = T.performanceFor(ID).stallLanding * 1.25;
  ac.setFlaps(flaps);
  const ctrl = { throttle: 1, brakes: 0, pitch: 0, roll: 0, yaw: 0 };
  let lift = null;
  let at15 = null;
  let liftKt = 0;
  let maxSweep = 0;
  for (let tt = 0; tt < 120 && at15 === null; tt += 0.2) {
    if (ac.onGround) ctrl.pitch = ac.ias * KT > vr ? 0.45 : 0;
    else ctrl.pitch = clamp((10 - ac.pitchAngleDeg()) * 0.05, -0.5, 0.6);
    run(ac, 0.2, ctrl, () => {
      const c = gearClearance(ac);
      maxSweep = Math.max(maxSweep, sw.sweep);
      if (lift === null && !ac.onGround && c > 0.3) {
        lift = ac.pos.x - rw.start;
        liftKt = ac.ias * KT;
      }
      if (at15 === null && c > 15) at15 = ac.pos.x - rw.start;
    });
    if (ac.crashed) break;
  }
  const r = (v) => (v === null ? null : Math.round(v));
  return { crashed: ac.crashed ? ac.crashReason : false, lift: r(lift), liftKt, at15: r(at15), maxSweep, burner: sw.burner };
}

function yankTakeoff(rw, flaps) {
  const { ac } = make('simplified');
  ac.reset({ pos: new THREE.Vector3(rw.start, rw.elev, rw.z), headingDeg: 90, engineOn: true });
  ac.setFlaps(flaps);
  const tail = P.SPEC.hardPoints.find((h) => h.part === 'tail');
  let at15 = null;
  let minTail = Infinity;
  // To 150 m up: the take-off. (Held on for a minute more, the burners' thrust
  // takes it over the top of a loop — what any aeroplane this light and this
  // powerful does — and that is not the question here.)
  for (let s = 0; s < 80 * 60 && !ac.crashed && !(at15 !== null && gearClearance(ac) > 150); s++) {
    run(ac, 1 / 60, { throttle: 1, brakes: 0, pitch: 1, roll: 0, yaw: 0 }, () => {
      _w.copy(tail.pos).applyQuaternion(ac.quat).add(ac.pos);
      minTail = Math.min(minTail, _w.y - TER.heightAt(_w.x, _w.z));
      if (at15 === null && !ac.onGround && gearClearance(ac) > 15) at15 = ac.pos.x - rw.start;
    });
  }
  return { crashed: ac.crashed ? ac.crashReason : false, at15: at15 === null ? null : Math.round(at15), minTail };
}

/** A landing down a 3 degree path at 1.3 x approach speed, full flap, idle at 12 m, full brakes; aiming 200 m in. */
function landing(rw) {
  const { ac, sw } = make('simplified');
  const perf = T.performanceFor(ID);
  const vapp = (perf.stallLanding * 1.3) / KT;
  const aim = rw.x0 + 200;
  const startX = aim - 450 - perf.stallLanding * 2;
  ac.reset({ pos: new THREE.Vector3(startX, 0, rw.z), headingDeg: 90, speed: vapp, altAGL: 0, engineOn: true, gearDown: true });
  const low = Math.min(...P.SPEC.gearPoints.map((g) => g.pos.y));
  ac.pos.y = rw.elev + Math.tan(3 / DEG) * (aim - startX) - low;
  ac.setFlaps(3);
  ac.flaps = 1;
  ac.rpm = 0.45;
  const ctrl = { throttle: 0.45, brakes: 0, pitch: 0, roll: 0, yaw: 0 };
  let x15 = null;
  let td = null;
  let stop = null;
  let idle = false;
  let maxSweep = 0;
  for (let tt = 0; tt < 200 && stop === null; tt += 1 / 30) {
    const c = gearClearance(ac);
    if (td === null && !ac.onGround) {
      const wantH = Math.max(0, Math.tan(3 / DEG) * (aim - ac.pos.x));
      let wantVs = -Math.tan(3 / DEG) * ac.groundSpeed + (wantH - c) * 0.3;
      if (c < 12) {
        idle = true;
        wantVs = -0.5 - c * 0.12;
      }
      ctrl.pitch = clamp((wantVs - ac.vs) * 0.15 - ac.omega.x * 0.8, -0.6, 0.9);
      ctrl.throttle = idle ? 0 : clamp(ctrl.throttle + (vapp - ac.airspeed) * 0.01, 0, 0.84);
      ctrl.roll = clamp(-ac.bankAngleRad() * 2.2 - ac.omega.z * 0.7, -1, 1);
    } else {
      Object.assign(ctrl, { throttle: 0, pitch: 0, brakes: 1, roll: 0 });
    }
    run(ac, 1 / 30, ctrl, () => {
      maxSweep = Math.max(maxSweep, sw.sweep);
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
    stopPastThreshold: stop === null ? null : stop - rw.x0,
    grade: ac.lastTouchdown && ac.lastTouchdown.quality,
    maxSweep,
    creep: ac.groundSpeed,
  };
}

function handsOff(kt, alt, { sweep = null } = {}) {
  const { ac, sw } = make('simplified');
  ac.reset({ pos: new THREE.Vector3(-6000, 0, 6000), headingDeg: 90, speed: kt / KT, altAGL: alt, engineOn: true, gearDown: false });
  if (sweep !== null) {
    sw.mode = 'manual';
    sw.manual = sweep;
    sw.sweep = sweep;
  }
  ac.rpm = 0.6;
  let late = 0;
  let tt = 0;
  run(ac, 40, { throttle: 0.6, pitch: 0, roll: 0, yaw: 0, brakes: 0 }, () => {
    tt += 1 / 60;
    if (tt > 25) late = Math.max(late, Math.abs(ac.omega.x) * DEG);
  });
  return { late, crashed: ac.crashed };
}

/** Flat out, level, `alt` metres: where the speed settles, and how long Mach 1 took. */
function dash(alt, seconds, { sweep = null, thr = 1, speed = 150 } = {}) {
  const { ac, sw } = make('simplified');
  ac.reset({ pos: new THREE.Vector3(-30000, 0, 30000), headingDeg: 90, speed, altAGL: alt, engineOn: true, gearDown: false });
  ac.pos.y = alt;
  ac.rpm = 0.18 + 0.82 * thr;
  if (sweep !== null) {
    sw.mode = 'manual';
    sw.manual = sweep;
    sw.sweep = sweep;
  }
  let m1 = null;
  let maxM = 0;
  let overspeed = 0;
  ac.on && ac.on('overspeed', () => overspeed++);
  for (let s = 0; s < seconds * 120 && !ac.crashed; s++) {
    ac.controls.throttle = thr;
    const wantVs = clamp((alt - ac.pos.y) * 0.08, -8, 8);
    ac.controls.pitch = clamp((wantVs - ac.vs) * 0.05 - ac.omega.x * 1.5, -0.8, 0.8);
    ac.controls.roll = 0;
    ac.controls.yaw = 0;
    ac.controls.brakes = 0;
    ac.update(1 / 120, weather);
    maxM = Math.max(maxM, sw.mach);
    if (m1 === null && sw.mach >= 1) m1 = s / 120;
  }
  return { kt: ac.airspeed * KT, ias: ac.ias * KT, M: sw.mach, maxM, m1, sweep: sw.sweep, crashed: ac.crashed && ac.crashReason, burner: sw.burner };
}

const report = [];
{
  const rw = runwayOf('kestrel');
  const ahead = rw.end - rw.start;
  // Standing still where it spawns: the height from its own gear.
  const { ac } = make('simplified');
  ac.reset({ pos: new THREE.Vector3(rw.start, rw.elev, rw.z), headingDeg: 90, engineOn: true });
  const y0 = ac.pos.y;
  const pitch0 = ac.pitchAngleDeg();
  const lowG = Math.min(...P.SPEC.gearPoints.map((g) => g.pos.y));
  run(ac, 5, { throttle: 0, pitch: 0, roll: 0, yaw: 0, brakes: 0 });
  ok('kestrel: spawns standing on its own wheels (height from its gear) and stays put',
    !ac.crashed && ac.onGround && Math.abs(ac.pos.y - y0) < 0.05 && Math.abs(ac.pitchAngleDeg() - pitch0) < 0.3 && Math.abs(y0 - rw.elev + lowG) < 0.6,
    `y0 ${(y0 - rw.elev).toFixed(2)} m (gear ${lowG.toFixed(2)}), moved ${(ac.pos.y - y0).toFixed(3)} m`);
  run(ac, 5, { throttle: 0, pitch: 0, roll: 0, yaw: 0, brakes: 1 });
  ok('kestrel: held on the brakes at idle under 2.3 m/s (the landing missions call 2.5 "stopped")', ac.groundSpeed < 2.3, `${ac.groundSpeed.toFixed(2)} m/s`);

  const to = takeoff(rw);
  ok(`kestrel: takes off within the 1,100 m strip with the wing forward (15 m up before its end)`, !to.crashed && to.at15 !== null && to.at15 < ahead && to.maxSweep <= 15.01,
    `${to.crashed || ''} lift-off ${to.lift} m at ${Math.round(to.liftKt)} kt, 15 m at ${to.at15} m; sweep stayed ${to.maxSweep.toFixed(1)}; burners ${to.burner.toFixed(2)}`);
  const toReal = takeoff(rw, { mode: 'realistic' });
  ok('kestrel: takes off in realistic mode too', !toReal.crashed && toReal.at15 !== null && toReal.at15 < ahead, `${toReal.crashed || ''} ${toReal.at15} m`);
  const toClean = takeoff(rw, { flaps: 0 });
  ok('kestrel: even flaps up it gets off (the wing is forward)', !toClean.crashed && toClean.at15 !== null && toClean.at15 < ahead, `${toClean.crashed || ''} ${toClean.at15} m`);
  for (const f of [0, t.takeoffFlaps]) {
    const y = yankTakeoff(rw, f);
    ok(`kestrel: stick held fully back from brake release, flaps ${f}: flies before the runway ends, tail clear`,
      !y.crashed && y.at15 !== null && y.at15 < ahead && y.minTail > 0.3, `${y.crashed || ''} 15 m at ${y.at15} m, tail never closer than ${y.minTail.toFixed(2)} m`);
  }
  const ld = landing(rw);
  ok('kestrel: lands and stops within the 1,100 m strip', !ld.crashed && ld.stopPastThreshold !== null && ld.stopPastThreshold < rw.len && ld.maxSweep <= 15.01,
    `${ld.crashed || ''} ${Math.round(ld.from15)} m from 15 m, roll ${Math.round(ld.roll)} m, stopped ${Math.round(ld.stopPastThreshold)} m past the threshold (${ld.grade}); sweep ${ld.maxSweep.toFixed(1)}`);
  // A whole circuit with the scripted pilot the browser check uses.
  {
    const { ac: ac2, sw } = make('simplified');
    const runway = { x0: rw.x0, z0: rw.z, headingDeg: 90, length: rw.len, elev: rw.elev };
    ac2.reset({ pos: new THREE.Vector3(rw.start, rw.elev, rw.z), headingDeg: 90, engineOn: true });
    ac2.setFlaps(t.takeoffFlaps);
    const pilot = circuitPilot({ ac: ac2, runway, perf: T.performanceFor(ID), giant: false, heightAt: TER.heightAt, gear: (d) => { ac2.gearDown = d; }, flaps: (s) => ac2.setFlaps(s) });
    let secs = 0;
    let maxSweep = 0;
    while (!pilot.done && secs < 900) {
      const c = pilot.step(1 / 30);
      for (let k = 0; k < 4; k++) {
        Object.assign(ac2.controls, c);
        ac2.update(1 / 120, weather);
      }
      maxSweep = Math.max(maxSweep, sw.sweep);
      secs += 1 / 30;
      if (ac2.crashed) pilot.fail(`crashed: ${ac2.crashReason} (${pilot.phase})`);
    }
    if (!pilot.done) pilot.fail(`timed out (${pilot.phase})`);
    const S = pilot.state;
    ok('kestrel: flies a whole left-hand circuit and lands, stopping on the runway',
      pilot.ok && S.stopAlong < rw.len && Math.abs(S.stopCross) < rw.half - 3, `${Math.round(secs)} s; ${pilot.log.slice(-3).join('; ')}; most sweep ${maxSweep.toFixed(1)}`);
  }
  for (const [kt, alt, sweep] of [[280, 1500, null], [450, 300, 67.5], [520, 12000, 67.5]]) {
    const h = handsOff(kt, alt, { sweep });
    ok(`hands-off at ${kt} kt, ${Math.round(alt * FT)} ft, wing ${sweep ?? 'AUTO'}: holds its pitch`, !h.crashed && h.late < 2, `${h.late.toFixed(2)} deg/s after 25 s`);
  }
  report.push(`kestrel 1100 m: take-off ${to.at15} m to 15 m (lift-off ${to.lift} m, ${Math.round(to.liftKt)} kt; realistic ${toReal.at15}; flaps up ${toClean.at15}), landing ${Math.round(ld.from15)} m from 15 m (roll ${Math.round(ld.roll)} m)`);
}

/* The swing wing in flight. */
{
  // AUTO sweeps back as it accelerates, forward again for the flaps.
  const { ac, sw } = make('simplified');
  ac.reset({ pos: new THREE.Vector3(-30000, 0, 30000), headingDeg: 90, speed: 120, altAGL: 3000, engineOn: true, gearDown: false });
  ac.pos.y = 3000;
  ac.rpm = 1;
  const hold = () => {
    ac.controls.pitch = clamp((clamp((3000 - ac.pos.y) * 0.08, -8, 8) - ac.vs) * 0.05 - ac.omega.x * 1.5, -0.8, 0.8);
    ac.controls.roll = 0;
  };
  for (let s = 0; s < 120 * 120; s++) {
    ac.controls.throttle = 1;
    hold();
    ac.update(1 / 120, weather);
  }
  const back = sw.sweep;
  ok('AUTO: full burners at 10,000 ft and the wing sweeps all the way back by itself', back === 67.5 && sw.mode === 'auto', `${back.toFixed(1)} deg at ${(ac.ias * KT).toFixed(0)} kt, M ${sw.mach.toFixed(2)}`);
  // The pilot takes over: a notch forward.
  ok('keys: [ takes it out of AUTO to the next notch forward', sw.nudge(-1, ac) === 'notch' && sw.mode === 'manual' && sw.manual === 45);
  for (let s = 0; s < 120 * 6; s++) {
    ac.controls.throttle = 0.6;
    hold();
    ac.update(1 / 120, weather);
  }
  ok('keys: the wing moves to 45 at 6 deg/s and stays there', Math.abs(sw.sweep - 45) < 0.01, sw.sweep.toFixed(2));
  sw.nudge(1, ac);
  ok('keys: ] goes back a notch', sw.manual === 67.5);
  sw.nudge(-1, ac);
  sw.nudge(-1, ac);
  sw.nudge(-1, ac);
  ok('keys: [ three times walks it 45, 25, 15', sw.manual === 15 && sw.mode === 'manual');
  ok('keys: [ at the forward stop puts AUTO back', sw.nudge(-1, ac) === 'auto' && sw.mode === 'auto');
  // Slow down to circuit speed; flaps out: the wing must already be forward.
  for (let s = 0; s < 120 * 90; s++) {
    ac.controls.throttle = 0.25;
    hold();
    ac.update(1 / 120, weather);
  }
  ac.setFlaps(2);
  for (let s = 0; s < 120 * 4; s++) {
    ac.controls.throttle = 0.4;
    hold();
    ac.update(1 / 120, weather);
  }
  ok('AUTO: slow, with the flaps out, the wing is forward and the flaps run', sw.sweep === 15 && ac.flaps > 0.4, `${sw.sweep.toFixed(1)} deg, flaps ${ac.flaps.toFixed(2)} at ${(ac.ias * KT).toFixed(0)} kt`);
  sw.notes.length = 0;
  ok('flaps: a notch aft with the flaps down is refused, with the reason', sw.nudge(1, ac) === 'refused' && sw.notes.some((n) => /Flaps up first/.test(n.text)));
  // Manual 45, then flaps: they wait for the wing.
  ac.setFlaps(0);
  for (let s = 0; s < 120 * 4; s++) {
    ac.controls.throttle = 0.5;
    hold();
    ac.update(1 / 120, weather);
  }
  // Into MANUAL, at 45 (AUTO may have the wing at 25 already, so walk to the notch).
  sw.nudge(1, ac);
  while (sw.manual > 45) sw.nudge(-1, ac);
  while (sw.manual < 45) sw.nudge(1, ac);
  for (let s = 0; s < 120 * 8; s++) {
    ac.controls.throttle = 0.6;
    hold();
    ac.update(1 / 120, weather);
  }
  sw.notes.length = 0;
  ac.setFlaps(2);
  for (let s = 0; s < 120 * 3; s++) {
    ac.controls.throttle = 0.6;
    hold();
    ac.update(1 / 120, weather);
  }
  ok('flaps: selected with the wing swept (MANUAL 45), they wait, and the pilot is told why', ac.flaps === 0 && sw.sweep > 40 && sw.notes.some((n) => /Flaps wait/.test(n.text)), `flaps ${ac.flaps}, sweep ${sw.sweep.toFixed(1)}`);
  while (sw.mode === 'manual' && sw.manual > 15) sw.nudge(-1, ac);
  for (let s = 0; s < 120 * 8; s++) {
    ac.controls.throttle = 0.6;
    hold();
    ac.update(1 / 120, weather);
  }
  ok('flaps: and run as soon as the wing is forward', sw.sweep <= 20 && ac.flaps > 0.3, `sweep ${sw.sweep.toFixed(1)}, flaps ${ac.flaps.toFixed(2)}`);
  // Wheels down with the wing swept, in MANUAL: told to bring it forward.
  const { ac: a2, sw: s2 } = make('simplified');
  a2.reset({ pos: new THREE.Vector3(-30000, 0, 30000), headingDeg: 90, speed: 150, altAGL: 2000, engineOn: true, gearDown: true });
  s2.reset(67.5);
  s2.mode = 'manual';
  s2.manual = 67.5;
  for (let s = 0; s < 120 * 2; s++) {
    a2.controls.throttle = 0.7;
    a2.update(1 / 120, weather);
  }
  ok('MANUAL: the wheels down with the wing swept, the pilot is told to bring it forward', s2.notes.some((n) => /Wheels down with the wings swept/.test(n.text)) && s2.sweep === 67.5,
    s2.notes.map((n) => n.text).join(' | '));
}

/* The burners and the sound barrier. */
{
  const hi = dash(12000, 420);
  ok('supersonic: at 40,000 ft with the burners lit and AUTO, it goes through Mach 1 and on past 1.2', hi.maxM >= 1.2 && hi.m1 !== null && hi.m1 < 240 && hi.sweep === 67.5 && !hi.crashed,
    `Mach 1 at ${hi.m1 && hi.m1.toFixed(0)} s, settles at M ${hi.M.toFixed(3)} (${hi.kt.toFixed(0)} kt true, ${hi.ias.toFixed(0)} indicated)`);
  ok('supersonic: and never past the inlets\' Mach 1.25 (+0.02)', hi.maxM < 1.27, hi.maxM.toFixed(3));
  const fwd = dash(12000, 300, { sweep: 15 });
  ok('swing wing: with it held forward the transonic wall stops it under Mach 0.85', fwd.maxM < 0.85, `M ${fwd.maxM.toFixed(3)}`);
  const mid = dash(12000, 300, { sweep: 45 });
  ok('swing wing: at 45 it gets nearer, but not through', mid.maxM > fwd.maxM + 0.05 && mid.maxM < 1.0, `M ${mid.maxM.toFixed(3)}`);
  const dry = dash(12000, 300, { thr: 0.84 });
  ok('burners: without them (84% throttle) it is subsonic, like every other jet', dry.maxM < 0.8, `M ${dry.maxM.toFixed(3)}`);
  const sea = dash(150, 240);
  ok('low level: the dash at 500 ft is high subsonic (M 0.85-0.96), under the red line', sea.M > 0.85 && sea.M < 0.96 && sea.ias < a.vne * KT && !sea.crashed,
    `M ${sea.M.toFixed(3)}, ${sea.kt.toFixed(0)} kt (red line ${Math.round(a.vne * KT)} kt indicated)`);
  // Honest about Air Massimo: on the bare flight model (fighters.mjs's race) Massimo stays the fastest;
  // with the Lancer's burners lit (the game), the Lancer is faster. Printed, for the owner to decide.
  const m = (() => {
    P.applyAircraft('massimo');
    const ac = new P.Aircraft();
    ac.mode = 'simplified';
    ac.reset({ pos: new THREE.Vector3(-30000, 0, 30000), headingDeg: 90, speed: 150, altAGL: 2500, engineOn: true, gearDown: false });
    ac.pos.y = 2500;
    ac.rpm = 1;
    for (let s = 0; s < 300 * 120; s++) {
      ac.controls.throttle = 1;
      ac.controls.pitch = clamp((clamp((2500 - ac.pos.y) * 0.08, -8, 8) - ac.vs) * 0.05 - ac.omega.x * 1.5, -0.8, 0.8);
      ac.controls.roll = 0;
      ac.update(1 / 120, weather);
    }
    return ac.airspeed * KT;
  })();
  const mid25 = dash(2500, 300);
  info(`top speeds, level, 300 s: Lancer at 8,200 ft ${mid25.kt.toFixed(0)} kt (M ${mid25.M.toFixed(2)}), at 40,000 ft ${hi.kt.toFixed(0)} kt (M ${hi.M.toFixed(2)}); Air Massimo at 8,200 ft ${m.toFixed(0)} kt. ` +
    'The owner asked for a supersonic B-1B; that makes it faster than Massimo with its burners lit. fighters.mjs races the bare flight model, where Massimo still wins.');
  report.push(`dash: 500 ft M ${sea.M.toFixed(2)} (${sea.kt.toFixed(0)} kt), 40,000 ft M ${hi.M.toFixed(2)} (${hi.kt.toFixed(0)} kt; Mach 1 at ${hi.m1 && hi.m1.toFixed(0)} s), wing forward M ${fwd.maxM.toFixed(2)}, 45 deg M ${mid.maxM.toFixed(2)}, dry M ${dry.maxM.toFixed(2)}`);
}

/* The wrapper leaves SPEC as it found it. */
{
  const FIELDS = ['wingSpan', 'CLa', 'CL0', 'alphaStall', 'k', 'CD0', 'Cmalpha', 'Clda', 'Izz', 'thrustMax', 'fuelBurnMax'];
  const snap = () => JSON.stringify({ s: FIELDS.map((k) => P.SPEC[k]), h: P.SPEC.hardPoints.map((h) => h.pos.toArray()) });
  const { ac, sw } = make('simplified');
  ac.reset({ pos: new THREE.Vector3(-30000, 0, 30000), headingDeg: 90, speed: 280, altAGL: 9000, engineOn: true, gearDown: false });
  ac.pos.y = 9000;
  ac.rpm = 1;
  sw.reset(67.5);
  const before = snap();
  const baseThrust = P.SPEC.thrustMax;
  for (let i = 0; i < 240; i++) {
    ac.controls.throttle = 1;
    ac.update(1 / 120, weather);
  }
  ok('wrapper: SPEC is exactly as it was between steps, strike points included, after 240 swept, burning steps', snap() === before);
  // Peek at SPEC from inside one step (a getter on the controls the physics reads).
  const ctl = ac.controls;
  let peek = null;
  Object.defineProperty(ac, 'controls', { configurable: true, get() { if (!peek) peek = { span: P.SPEC.wingSpan, thrust: P.SPEC.thrustMax }; return ctl; } });
  ac.update(1 / 120, weather);
  delete ac.controls;
  ac.controls = ctl;
  ok('wrapper: inside the step SPEC is the swept wing and the burners', !!peek && Math.abs(peek.span - 23.84) < 0.01 && peek.thrust > baseThrust * 2, JSON.stringify(peek));
  // A fault inside it: switched off once, SPEC put back, the aeroplane still flies.
  P.applyAircraft(ID);
  const ac4 = new P.Aircraft();
  ac4.mode = 'simplified';
  ac4.reset({ pos: new THREE.Vector3(-30000, 0, 30000), headingDeg: 90, speed: 150, altAGL: 3000, engineOn: true, gearDown: false });
  const errs = [];
  const bad = new SW.SwingWing();
  bad.pre = function (acx, dt) {
    SW.SwingWing.prototype.pre.call(this, acx, dt);
    throw new Error('test fault');
  };
  SW.wrapUpdate(ac4, bad, { onError: (e) => errs.push(e.message) });
  const s0 = snap();
  const x0 = ac4.pos.x;
  for (let i = 0; i < 120; i++) ac4.update(1 / 120, weather);
  ok('wrapper: a throw inside it switches it off once, puts SPEC back, and the aeroplane keeps flying',
    bad.broken && errs.length === 1 && snap() === s0 && ac4.pos.x > x0 + 100 && !ac4.crashed, errs.join(','));
}

console.log('\n' + report.join('\n'));
if (fails.length) console.log('\nFAILED:\n  ' + fails.join('\n  '));
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

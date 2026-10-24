/**
 * The aeroplanes added by new-aircraft (owner, 2026-10-16: "add popular
 * planes and bigger planes like the beluga"), checked in node against the
 * real roster, the real model factory and the real flight model.
 *
 *   node tests/features/new-aircraft.mjs [id ...]
 *
 * Exits non-zero if anything fails. Every take-off and landing is flown on
 * physics.js at its own 120 Hz step, on the map each type is meant for: the
 * popular ones on the 1,100 m Kestrel strip like every other airliner, the
 * giants on Gateway International's 3,800 m. The flying is
 * tests/features/airliners.mjs's, generalised to the runway's length.
 *
 * The project's aircraft rules, each checked per type:
 *   - aeroplanes must be sized to the runway (take-off and landing distances);
 *   - gear stiffness scales with mass (pointsFor; the spring holds it at the
 *     same fraction of its travel as the trainer's);
 *   - spawn height from its own gear (it stands still where it spawns);
 *   - jets need JetSound and a yaw damper (power.kind, spec.yawDamper);
 *   - the cockpit is placed from the type's eye (the eye inside the flight
 *     deck, under its roof, behind its windscreen).
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

const SRC = new URL('../../src/', import.meta.url).href;
const THREE = await import(SRC + 'vendor/three.module.js');
const T = await import(SRC + 'aircraft/types.js');
const P = await import(SRC + 'aircraft/physics.js');
const TER = await import(SRC + 'world/terrain.js');
const FEATURE = await import(SRC + 'features/airliners.js');
const PROG = await import(SRC + 'game/progression.js');
const { AIRLINER_GEOMETRY } = await import(SRC + 'aircraft/extra/airliners.js');
const { JET_GEOMETRY } = await import(SRC + 'aircraft/extra/jets.js');
const { GIANT_GEOMETRY } = await import(SRC + 'aircraft/extra/giants.js');
const { C17_GEOMETRY } = await import(SRC + 'aircraft/extra/c17.js');
const GEOM = { ...JET_GEOMETRY, ...GIANT_GEOMETRY, ...C17_GEOMETRY };
const { circuitPilot } = await import(new URL('./circuit-pilot.js', import.meta.url).href);

const KT = 1.94384;
const DEG = 180 / Math.PI;

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

/** Real span and length (m), from the manufacturers' published figures. */
const REAL = {
  b737: { span: 35.92, length: 39.52, longHaul: false, map: 'kestrel' },
  a321: { span: 35.8, length: 44.51, longHaul: false, map: 'kestrel' },
  b787: { span: 60.12, length: 62.81, longHaul: true, map: 'kestrel' },
  a350: { span: 64.75, length: 66.8, longHaul: true, map: 'kestrel' },
  b777: { span: 64.8, length: 73.86, longHaul: true, map: 'kestrel' },
  q400: { span: 28.42, length: 32.83, longHaul: false, map: 'kestrel', prop: true },
  // The needle nose puts the flight deck 9 m back; the indicated limit is a
  // supersonic airliner's, not a subsonic one's.
  concorde: { span: 25.6, length: 61.66, longHaul: false, map: 'kestrel', deck: 10, vne: [400, 480] },
  // The giants: flown from Gateway International's 3,800 m, and they must
  // NOT fit the 1,100 m strip — that is the point of them.
  belugaxl: { span: 60.3, length: 63.1, longHaul: true, map: 'gateway', giant: true },
  dreamlifter: { span: 64.44, length: 71.68, longHaul: true, map: 'gateway', giant: true },
  an225: { span: 88.4, length: 84.0, longHaul: true, map: 'gateway', giant: true },
  c5: { span: 67.89, length: 75.31, longHaul: true, map: 'gateway', giant: true, military: true },
  // The C-17 (aircraft/extra/c17.js): a military freighter built for short strips, so it flies
  // from Kestrel like the airliners; no cabin, a crew door and a paratroop door each side.
  c17: { span: 51.75, length: 53.04, longHaul: true, map: 'kestrel', military: true, freighter: true },
};
const ARGS = process.argv.slice(2);
const IDS = Object.keys(REAL).filter((id) => !ARGS.length || ARGS.includes(id));

/* ------------------------------------------------------------------ *
 * The roster
 * ------------------------------------------------------------------ */
for (const id of IDS) {
  const t = T.AIRCRAFT.find((a) => a.id === id);
  ok(`${id}: in AIRCRAFT`, !!t);
  if (!t) continue;
  const R = REAL[id];
  if (R.military) {
    ok(`${id}: an Airliner by class (cockpit, spawns, evacuation) filed under Military, behind the passcode`,
      t.class === 'Airliner' && t.category === 'military' && t.military === true && PROG.needsPasscode({ militaryUnlocked: false }, t));
  } else {
    ok(`${id}: an Airliner (cockpit, spawns, evacuation all read the class)`, t.class === 'Airliner' && t.category === 'airliner' && t.military !== true);
  }
  if (R.giant) ok(`${id}: a freighter that says how much runway it needs`, t.freighter === true && t.minRunway >= 2000 && t.minRunway <= 3000, `${t.minRunway} m`);
  else ok(`${id}: no runway minimum (it uses the Kestrel strip)`, !t.minRunway);
  ok(`${id}: longHaul is ${R.longHaul}`, t.longHaul === R.longHaul);
  ok(`${id}: named, described, with a callsign and a cockpit hint`,
    typeof t.name === 'string' && t.name.length > 3 && t.blurb.length > 60 && !!t.callsign && ['jet', 'big-jet', 'turboprop'].includes(t.cockpit));
  ok(`${id}: no maker's logo or trademark words in the text`, !/logo|™|®/i.test(`${t.name} ${t.blurb}`));
  ok(`${id}: stats are 1-5 pips`, ['speed', 'handling', 'ease'].every((k) => Number.isInteger(t.stats[k]) && t.stats[k] >= 1 && t.stats[k] <= 5));
  const a = t.aero;
  ok(`${id}: every aero number finite`, Object.values(a).filter((v) => typeof v === 'number').every(Number.isFinite));
  ok(`${id}: undercarriage can hold it (mass < 32 t; each leg caps at 160 kN)`, a.mass > 10000 && a.mass < 32000, `${a.mass} kg`);
  const W = a.mass * 9.80665;
  const [tw0, tw1, wl0, wl1] = R.giant ? [0.22, 0.3, 220, 290] : [0.25, 0.5, 150, 260];
  ok(`${id}: thrust-to-weight ${tw0}-${tw1}`, a.thrustMax / W > tw0 && a.thrustMax / W < tw1, (a.thrustMax / W).toFixed(2));
  ok(`${id}: wing loading ${wl0}-${wl1} kg/m2`, a.mass / a.wingArea > wl0 && a.mass / a.wingArea < wl1, (a.mass / a.wingArea).toFixed(0));
  ok(`${id}: real span in the flight model`, Math.abs(a.wingSpan - R.span) < 0.5, `${a.wingSpan} m`);
  ok(`${id}: inertias positive, yaw the largest`, a.Ixx > 0 && a.Izz > 0 && a.Iyy >= Math.max(a.Ixx, a.Izz));
  const perf = T.performanceFor(id);
  // 1.3 x this is the approach; physics.js crashes any touchdown over 62 m/s (120 kt) on the ground.
  ok(`${id}: approach speed 60-82 kt, so the approach (x 1.3) stays well under the 120 kt touchdown limit`, perf.stallLanding >= 60 && perf.stallLanding <= 82, `${perf.stallLanding} kt`);
  const [v0, v1] = R.vne || [300, 400];
  ok(`${id}: top speed ${v0}-${v1} kt`, perf.vne >= v0 && perf.vne <= v1, `${perf.vne} kt`);
  if (R.longHaul) ok(`${id}: long-haul endurance over 5 h at full power`, perf.enduranceMin > 300, `${perf.enduranceMin} min`);
  const spec = T.specFor(id);
  if (R.prop) {
    ok(`${id}: a twin turboprop — propeller effects on, no yaw damper (prop power), the propeller sound`,
      spec.propeller === true && spec.rotor === false && t.shape.power.kind === 'prop' && t.shape.power.count === 2);
  } else {
    ok(`${id}: jet — JetSound (power.kind jet), a yaw damper, no propeller`,
      t.shape.power.kind === 'jet' && spec.yawDamper === true && spec.propeller === false && spec.rotor === false);
  }
  // Gear stiffness scales with mass: the static deflection of the mains is the trainer's fraction of its travel.
  {
    const legs = spec.gearPoints;
    const kSum = legs.reduce((s, g) => s + g.k, 0);
    const defl = W / kSum;
    const tr = T.specFor('skylark');
    const trDefl = (1100 * 9.80665) / tr.gearPoints.reduce((s, g) => s + g.k, 0);
    const frac = defl / legs[1].travel;
    const trFrac = trDefl / tr.gearPoints[1].travel;
    ok(`${id}: gear stiffness scales with mass (static sag ${(frac * 100).toFixed(0)}% of travel; trainer ${(trFrac * 100).toFixed(0)}%)`,
      frac > 0.05 && frac < 0.8, `${defl.toFixed(3)} m of ${legs[1].travel.toFixed(2)} m`);
  }
  // Reachable: for sale in the hangar, and buying it unlocks it.
  const cost = PROG.costOf(id);
  ok(`${id}: for sale in the hangar at its own price`, cost > 0 && cost === t.price && FEATURE.PRICES[id] === t.price, `${cost} credits`);
  const wallet = { credits: cost, earned: 0, unlocked: ['skylark'], best: [], redeemed: [] };
  const bought = PROG.buy(wallet, id);
  ok(`${id}: buying it unlocks it`, bought.ok && PROG.isUnlocked(wallet, id) && wallet.credits === 0, JSON.stringify(bought));
  if (!R.military) ok(`${id}: not behind the military passcode`, !PROG.needsPasscode({ militaryUnlocked: false }, t));
  ok(`${id}: registered as an airliner (camera stretch, seat panel, take-off flap)`,
    FEATURE.AIRLINER_IDS.includes(id) && AIRLINER_GEOMETRY[id] === GEOM[id] && Number.isInteger(FEATURE.TAKEOFF_FLAPS[id]) && FEATURE.viewScale(id) > 1);
  // The physics shape agrees with the metres it came from.
  const g = GEOM[id];
  const tip = spec.hardPoints.find((h) => h.part === 'rightWing');
  ok(`${id}: wing-tip strike point at the drawn tip`, Math.abs(tip.pos.x - g.tip.x) < 0.05 && Math.abs(tip.pos.y - g.tip.y) < 0.05);
  const belly = spec.hardPoints.find((h) => h.part === 'fuselage');
  ok(`${id}: belly point on the drawn belly`, Math.abs(belly.pos.y + g.belly) < 0.02, `${belly.pos.y.toFixed(3)} vs ${-g.belly}`);
  const mainPt = spec.gearPoints.find((p) => p.name === 'right').pos;
  ok(`${id}: main contact where the description puts it`, Math.abs(mainPt.x - g.main.x) < 0.01 && Math.abs(mainPt.y - g.ground) < 0.01 && Math.abs(mainPt.z - g.main.z) < 0.01);
  const tailPt = spec.hardPoints.find((h) => h.part === 'tail');
  const phys = Math.atan2(tailPt.pos.y - mainPt.y, tailPt.pos.z - mainPt.z) * DEG;
  // 12 degrees, and the stall guard (simplified mode stops pulling at alphaStall - 0.045) well short of it.
  const guard = (a.alphaStall - 0.045) * DEG;
  ok(`${id}: the physics tail strikes just before the drawn one (${g.strike.deg.toFixed(2)} deg), at 11.8 deg or more, 2.2 deg past the stall guard (${guard.toFixed(1)})`,
    phys <= g.strike.deg + 0.05 && phys > g.strike.deg - 0.6 && phys >= 11.8 && phys - guard >= 2.2, `physics ${phys.toFixed(2)} deg`);
}

/* ------------------------------------------------------------------ *
 * The model, through the same factory main.js calls
 * ------------------------------------------------------------------ */
const ADAPTER = await import(SRC + 'aircraft/model-adapter.js');
const LIV = await import(SRC + 'aircraft/liveries.js');
const { doorsFor } = await import(SRC + 'aircraft/extra/airliners.js');
const { JET_SPECS } = await import(SRC + 'fleet/extra/jets.js');
const { GIANT_SPECS } = await import(SRC + 'fleet/extra/giants.js');
const { C17_SPECS } = await import(SRC + 'fleet/extra/c17.js');
const SPECS = { ...JET_SPECS, ...GIANT_SPECS, ...C17_SPECS };
const MENUS = await import(SRC + 'ui/menus.js').catch(() => null);
const EJECT = await import(SRC + 'features/eject/profiles.js');
const KIT = await import(SRC + 'fleet/extra/airliner-kit.js');
const HEAT = await import(SRC + 'features/heatseek/rules.js');
const GUNS = await import(SRC + 'features/gunsight/rules.js');
const WHO = await import(SRC + 'features/carrier/who.js');
const PROTO = await import(SRC + 'features/multiplayer/protocol.js');

const TYRES = { b737: 6, a321: 6, b787: 10, a350: 10, b777: 14, q400: 6, concorde: 10, belugaxl: 10, dreamlifter: 18, an225: 32, c5: 28, c17: 14 };
const r2 = (v) => +v.toFixed(2);

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
      const p = g.attributes.position;
      for (let i = 0; i < p.array.length; i++) if (!Number.isFinite(p.array[i])) bad++;
      verts += p.count;
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
/** Vertices of everything except wheels, legs and engines, in the model frame. */
function airframePoints(model) {
  model.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(model.matrixWorld).invert();
  const out = [];
  const v = new THREE.Vector3();
  model.traverse((o) => {
    if (!o.isMesh || o.isInstancedMesh || !o.geometry) return;
    for (let p = o; p; p = p.parent) if (/gear|engine|propulsion|propeller/i.test(p.name)) return;
    const pos = o.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld).applyMatrix4(inv);
      out.push([v.x, v.y, v.z]);
    }
  });
  return out;
}
function meshesNamed(model, re) {
  const out = [];
  model.traverse((o) => {
    if (o.isMesh && re.test(o.name)) out.push(o);
  });
  return out;
}

for (const id of IDS) {
  const R = REAL[id];
  const type = T.getAircraft(id);
  const model = ADAPTER.createAircraftModel({ type, livery: LIV.schemeFor(type, 'house') });
  ok(`${id}: drawn by the fleet pack (DRAWS), not the fallback`, !!model.userData.fleetBridge && ADAPTER.fleetCovers(id), ADAPTER.fleetStatus().error || '');
  const st = stats(model);
  ok(`${id}: zero NaN vertices or instance matrices`, st.bad === 0 && st.verts > 1000, `${st.bad} bad of ${st.verts}`);
  const budget = R.giant ? 18000 : 15000;
  ok(`${id}: under ${budget.toLocaleString('en-GB')} triangles`, st.tris < budget, `${Math.round(st.tris)}`);
  const fg = model.userData.flightGeometry;
  const b = fg.bounds;
  const span = b.max[0] - b.min[0];
  const length = b.max[2] - b.min[2];
  ok(`${id}: span within 2% of the real ${R.span} m`, Math.abs(span / R.span - 1) < 0.02, `${span.toFixed(2)} m`);
  ok(`${id}: length within 2% of the real ${R.length} m`, Math.abs(length / R.length - 1) < 0.02, `${length.toFixed(2)} m`);
  const plan = type.plan;
  ok(`${id}: the airfield's plan (nose, tail, span) is the drawing's, to half a metre`,
    Math.abs(plan.nose - b.min[2]) < 0.5 && Math.abs(plan.tail - b.max[2]) < 0.5 && Math.abs(plan.span - span) < 0.5,
    `plan ${plan.nose}..${plan.tail} x ${plan.span}; drawn ${r2(b.min[2])}..${r2(b.max[2])} x ${r2(span)}`);
  const spec = T.specFor(id);
  const off = ADAPTER.groundOffsetFor(model, spec);
  ok(`${id}: drawn tyres meet the physics contact points`, Math.abs(off) < 0.03, `${off.toFixed(3)} m`);
  ok(`${id}: three undercarriage legs the core animates, ${TYRES[id]} tyres`, model.userData.parts.gear.length === 3 && st.tyres === TYRES[id], `${model.userData.parts.gear.length} legs, ${st.tyres} tyres`);
  // Nothing hangs below the tyres.
  const low = Math.min(...airframePoints(model).map((p) => p[1]));
  const g = GEOM[id];
  ok(`${id}: no part of the airframe below the wheels`, low > g.ground + 0.2, `${r2(low)} m vs ground ${g.ground}`);

  // Tail strike, measured off the drawing as tests/features/airliners.mjs does.
  const tailPt = spec.hardPoints.find((h) => h.part === 'tail');
  const mainPt = spec.gearPoints.find((p) => p.name === 'right').pos;
  const phys = Math.atan2(tailPt.pos.y - mainPt.y, tailPt.pos.z - mainPt.z) * DEG;
  let drawn = 90;
  for (const [, y, z] of airframePoints(model)) {
    if (z < mainPt.z + 2) continue;
    drawn = Math.min(drawn, Math.atan2(y - mainPt.y, z - mainPt.z) * DEG);
  }
  ok(`${id}: tail strikes in the physics no later than on the drawing`, phys <= drawn + 0.35, `physics ${phys.toFixed(2)} deg, drawn ${drawn.toFixed(2)} deg`);

  // The cockpit is placed from the type's eye: inside the flight deck, under its roof, behind its windscreen.
  const eye = fg.eye;
  ok(`${id}: the model's eye is the type's eye`, eye.every((v, i) => Math.abs(v - g.eye[i]) < 1e-6) && Math.abs(type.shape.eye[2] * type.shape.scale - g.eye[2]) < 0.01);
  const deck = R.deck || 7;
  ok(`${id}: eye inside the flight deck (1.5-${deck} m behind the nose)`, eye[2] < g.noseZ + deck && eye[2] > g.noseZ + 1.5, eye.join(', '));
  {
    model.updateMatrixWorld(true);
    const e = new THREE.Vector3(...eye);
    const skins = [];
    // The flight deck's own roof: on the Beluga the cargo bubble rises
    // above it too (its front is the cargo door), and that is not a roof.
    const deckUp = SPECS[id].flightDeckOn === 'upper';
    model.traverse((o) => {
      if (o.isMesh && !o.isInstancedMesh && /skin|fuselage|nose|deck|surface assembly/i.test(o.name) && (deckUp || !/^Upper deck/.test(o.name))) skins.push(o);
    });
    const rc = new THREE.Raycaster(e.clone().add(new THREE.Vector3(0, 12, 0)), new THREE.Vector3(0, -1, 0), 0, 12);
    const hit = rc.intersectObjects(skins, false)[0];
    let roof = hit ? hit.point.y - e.y : null;
    if (SPECS[id].hump && !deckUp) {
      // Its flight deck is in the lower loft; the skins are baked together, so measure that loft itself.
      const F = SPECS[id].fuselage;
      const hh = KIT.loftFuselage({ ...F, along: KIT.piecewise(F.alongKnots) });
      roof = hh.topAt(e.z) - e.y;
    }
    ok(`${id}: a roof over the pilot's head`, roof !== null && roof > 0.3 && roof < 2.2, roof === null ? 'nothing above the eye' : `${roof.toFixed(2)} m of headroom`);
  }
  const fd = model.userData.flightDeck;
  const panes = fd ? fd.panes : [];
  const ws = panes.filter((p) => /^Windscreen/.test(p.name));
  const wy = ws.flatMap((p) => p.corners.map((c) => c[1]));
  const wz = ws.flatMap((p) => p.corners.map((c) => c[2]));
  const aft = eye[2] - Math.max(...wz);
  ok(`${id}: six panes in frames, the windscreen at the pilot's eye — its height inside the panes, the glass 0.3-2.2 m ahead`,
    panes.length === 6 && ws.length === 2 && Math.min(...wy) < eye[1] && Math.max(...wy) > eye[1] && aft > 0.3 && aft < 2.2,
    `${panes.length} panes, y ${r2(Math.min(...wy))}..${r2(Math.max(...wy))}, eye y ${eye[1]}, glass ${r2(aft)} m ahead`);

  // Every pane corner given by its height sits on the side of the skin, below the crown: one
  // given above it collapses onto the top centreline and the pane folds into a zig-zag.
  {
    const S = SPECS[id];
    const F = S.fuselage;
    const deckLoft = S.flightDeckOn === 'upper' ? S.hump : F;
    const hh = KIT.loftFuselage({ ...deckLoft, along: KIT.piecewise(F.alongKnots) });
    const bad = [];
    for (const p of S.panes) for (const c of p.corners) if (c.y !== undefined && !(c.y < hh.topAt(c.z) - 0.03)) bad.push(`${p.name} z ${c.z} y ${c.y} (crown ${r2(hh.topAt(c.z))})`);
    ok(`${id}: every flight-deck pane corner lies on the side of the skin, below the crown`, bad.length === 0, bad.join('; '));
  }

  // Doors: the table is the drawing, they are shut by default and they open.
  const doors = model.userData.doors;
  const table = doorsFor(id);
  {
    const list = doors ? doors.list : [];
    const far = (table || []).filter((d) => {
      const m = list.find((q) => q.id === d.id);
      return !m || ['x', 'y', 'z', 'w', 'h', 'sill'].some((k) => Math.abs(m[k] - d[k]) > 0.02);
    });
    ok(`${id}: ${list.length} doors, the door table (AIRLINER_DOORS) is the drawing to 2 cm`, !!table && table.length === list.length && list.length === SPECS[id].doors.length && far.length === 0,
      far.map((d) => d.id).join(', ') || `${list.length} doors`);
    const leafOf = (d) => {
      let leaf = null;
      const n = doors.node(d.id);
      if (n) n.traverse((o) => { if (o.name === `Door ${d.id} leaf`) leaf = o; });
      return leaf;
    };
    const shut = list.every((d) => leafOf(d) && !leafOf(d).visible);
    if (doors) doors.open('all', { instant: true });
    const opened = list.every((d) => leafOf(d) && leafOf(d).visible);
    if (doors) doors.close('all', { instant: true });
    ok(`${id}: doors shut by default and swing open`, list.length > 0 && shut && opened);
    if (!R.giant && !R.freighter) ok(`${id}: a passenger cabin: windows in rows, two doors or more each side`, meshesNamed(model, /^Cabin window rows$/).reduce((n, w) => n + w.count, 0) > 40 && list.filter((d) => d.side === 'left' && d.kind === 'passenger').length >= 2);
  }
  // Every overlay on the skin is a decal with a polygon offset (no z-fighting with the skin from 300 m).
  {
    const overlays = meshesNamed(model, /^(Windscreen frames|Flight deck glass|Windscreen wipers|Cabin window rows|Airframe registration|Painted fin|Painted rudder|Titling|Whale eye|Whale smile|Swing tail seam)$|^Door .* opening$/);
    const plain = overlays.filter((m) => !(m.material.polygonOffset === true && m.material.polygonOffsetFactor < 0));
    ok(`${id}: every overlay on the skin carries the decal polygon offset (${overlays.length} of them)`, overlays.length >= 6 && plain.length === 0, plain.map((m) => m.name).join(', '));
  }
  // The lamps hang on the real wing tips.
  {
    const lamps = model.userData.lamps || {};
    ok(`${id}: navigation lamps on the drawn wing tips`, Array.isArray(lamps.navRight) && Math.abs(Math.abs(lamps.navRight[0]) - (g.tip.x)) < 2.5, JSON.stringify(lamps.navRight));
  }
  if (id === 'belugaxl') ok('belugaxl: the whale face — an eye each side of the bubble, a smile each side of the nose', meshesNamed(model, /^Whale eye$/).length === 2 && meshesNamed(model, /^Whale smile$/).length === 2);
  if (id === 'concorde') {
    const nose = (() => { let n = null; model.traverse((o) => { if (o.name === 'Droop nose') n = o; }); return n; })();
    const down = nose ? nose.rotation.x : 0;
    model.userData.update(5, { gearPos: 0, rpm: 0.8 }, {});
    const up = nose ? nose.rotation.x : 0;
    model.userData.update(5, { gearPos: 1, rpm: 0.2 }, {});
    ok('concorde: the nose droops 12.5 deg with the gear down and comes up with it away; no tailplane; four engines in box nacelles',
      !!nose && Math.abs(down + 0.218) < 0.01 && Math.abs(up) < 0.02 && Math.abs(nose.rotation.x + 0.218) < 0.02 && !model.userData.parts.leftElevator && meshesNamed(model, /^Engine box$|surface assembly/).length > 0 && model.userData.parts.engines.length === 4,
      `down ${down.toFixed(3)}, up ${up.toFixed(3)}`);
  }
  if (id === 'an225') ok('an225: six engines and a twin tail', model.userData.parts.engines.length === 6 && meshesNamed(model, /stabilizer/i).length + meshesNamed(model, /Fin and rudder surface assembly/).length >= 1 && Object.keys(model.userData.controls).filter((k) => /^rudder/.test(k)).length === 2);
  if (R.prop) {
    const props = model.userData.parts.engines.filter((e) => e.blades);
    ok(`${id}: two six-bladed propellers that spin`, props.length === 2 && props.every((e) => e.config.blades === 6));
  }
  // An adapter that throws on update would be switched off in a browser.
  let threw = null;
  try {
    for (let i = 0; i < 30; i++) model.userData.update(1 / 30, { rpm: 0.8, gearPos: i < 15 ? 1 : 0.3, onGround: i < 10, controls: { pitch: 0.3, roll: -0.2, yaw: 0.1 }, vel: new THREE.Vector3(0, 0, -60) }, {});
  } catch (e) {
    threw = e;
  }
  ok(`${id}: model animates without throwing`, !threw, threw ? String(threw) : '');
  model.userData.dispose();

  // Every paint scheme the hangar offers builds (the airline schemes, Air Force One) — the
  // remote players' and the traffic's models are built the same way.
  const schemes = LIV.LIVERIES.map((l) => l.id);
  const failedPaint = [];
  for (const sid of schemes) {
    try {
      const m = ADAPTER.createAircraftModel({ type, livery: LIV.schemeFor(type, sid) });
      if (!m.userData.fleetBridge) failedPaint.push(`${sid} (fallback)`);
      m.userData.dispose();
    } catch (e) {
      failedPaint.push(`${sid}: ${e.message}`);
    }
  }
  ok(`${id}: builds in every one of the ${schemes.length} paint schemes`, failedPaint.length === 0, failedPaint.join('; '));

  // Where the rest of the game files it.
  if (MENUS) ok(`${id}: the hangar files it under ${R.military ? 'Military' : 'Airliners'}`, MENUS.aircraftCategory(type) === (R.military ? 'military' : 'airliner'), MENUS.aircraftCategory(type));
  const prof = EJECT.profileFor(type);
  ok(`${id}: no ejection seats (an airliner's way out is a good landing; the passengers' evacuation reads the doors)`, prof.escape === 'none' && prof.uniform === 'captain');
  // School-safe: never a heat-seeker's target, not even another player's with PvP on.
  const v = HEAT.targetVerdict({ kind: 'player', typeId: id, pvpLive: true, name: 'Player' }, { pvp: true });
  ok(`${id}: never a heat-seeker's target, even in PvP`, v.ok === false, v.why);
  ok(`${id}: no guns, no missiles, no carrier hook${R.military ? ' (a military transport, not a combat jet)' : ''}`,
    !GUNS.hasGuns(type) && !WHO.isMilitary(type) && !WHO.hasHookFor(type));
  // A multiplayer remote's model: features/multiplayer/remotes.js paints it in the player's colour this way.
  {
    let built = false;
    try {
      const m = ADAPTER.createAircraftModel({ type, livery: { id: 'multiplayer', name: 'Multiplayer', base: '#3a7bd5', accent: '#ffffff', cheatline: 'rgba(255,255,255,0.9)', tail: 0x3a7bd5, reg: null } });
      built = !!m.userData.fleetBridge && Math.abs(ADAPTER.groundOffsetFor(m, T.specFor(id))) < 0.03;
      m.userData.dispose();
    } catch (e) {
      built = false;
    }
    const wire = PROTO.decodeStates(PROTO.encodeState({ id: 2, seq: 1, t: 0, pos: { x: 1, y: 2, z: 3 }, quat: { w: 1 }, vel: {}, game: 'flight', type: id }));
    ok(`${id}: a multiplayer remote builds it in a player's colour on its wheels, and the type crosses the wire`, built && wire[0] && wire[0].type === id);
  }
}

/* ------------------------------------------------------------------ *
 * Spawns: where a Free Flight puts it (world/spawns.js)
 * ------------------------------------------------------------------ */
{
  globalThis.window = globalThis.window || { addEventListener() {}, devicePixelRatio: 1 };
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
  for (const mid of ['kestrel', 'gateway']) {
    loadMap(mid);
    const lay = AL.airportLayout();
    const lines = [];
    for (const id of IDS) {
      const type = T.getAircraft(id);
      const cls = SP.spawnClassOf(type);
      const r = SP.resolveSpawn(mid, cls, { type, ctx: { layout: lay, traffic: [] } });
      const finite = [r.x, r.y, r.z, r.headingDeg].every(Number.isFinite);
      const clear = SP.clearReasons({ x: r.x, z: r.z, headingDeg: r.headingDeg, kind: r.kind, span: r.span, agl: r.agl }, { traffic: [] });
      const short = SP.needsLongerRunway(type);
      lines.push(`${id} ${r.kind}${r.fallback ? ' (fallback)' : ''} ${r.label}`);
      ok(`${mid} x ${id}: the airliner class, a finite clear start`, cls === 'airliner' && finite && (r.kind === 'runway' || clear.length === 0), `${r.kind} ${r.label} ${clear.join('; ')}`);
      if (type.minRunway && short) {
        ok(`${mid} x ${id}: too short a runway for a giant — it starts in the air, 300 m up, flying`, r.kind === 'hover' && r.agl === 300 && r.speed > 40, `${r.kind} ${r.label}`);
      } else if (type.minRunway) {
        ok(`${mid} x ${id}: a long enough runway — on the ground, at a stand or the open apron, not the runway fallback`, (r.kind === 'stand' || r.kind === 'apron') && !r.fallback, `${r.kind} ${r.label} (tried: ${(r.tried || []).slice(0, 3).map((q) => q.why).join(' | ')})`);
      } else {
        ok(`${mid} x ${id}: never started in the air`, r.kind !== 'hover', `${r.kind} ${r.label}`);
      }
    }
    console.log(`     ${mid}: ${lines.join(', ')}`);
  }
  // A type without minRunway gets exactly the lists it had.
  ok('spawns: the candidate lists are unchanged for every type without a runway minimum',
    JSON.stringify(SP.candidatesFor('kestrel', 'airliner', T.getAircraft('b737'))) === JSON.stringify(SP.candidatesFor('kestrel', 'airliner')));
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
/** The runway a type flies from: its map's main runway, from its 09 end. */
function runwayOf(id, map = REAL[id].map) {
  TER.applyMap(map);
  const r = TER.AIRPORT.runway;
  return { len: r.length, x0: r.cx - r.length / 2, start: r.cx - r.length / 2 + 80, end: r.cx + r.length / 2, elev: TER.heightAt(r.cx, r.cz), z: r.cz };
}
function make(id, mode) {
  P.applyAircraft(id);
  const ac = new P.Aircraft();
  ac.mode = mode;
  return ac;
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

/** The playtest's take-off: full power, flaps, 0.45 back stick at 1.25 × approach speed, then 10 degrees nose up. */
function takeoff(id, rw, { mode = 'simplified', flaps = 2 } = {}) {
  const ac = make(id, mode);
  ac.reset({ pos: new THREE.Vector3(rw.start, rw.elev, rw.z), headingDeg: 90, engineOn: true });
  const vr = T.performanceFor(id).stallLanding * 1.25;
  ac.setFlaps(flaps);
  const ctrl = { throttle: 1, brakes: 0, pitch: 0, roll: 0, yaw: 0 };
  let lift = null;
  let at15 = null;
  let liftKt = 0;
  for (let t = 0; t < 120 && at15 === null; t += 0.2) {
    if (ac.onGround) ctrl.pitch = ac.ias * KT > vr ? 0.45 : 0;
    else ctrl.pitch = Math.max(-0.5, Math.min(0.6, (10 - ac.pitchAngleDeg()) * 0.05));
    run(ac, 0.2, ctrl, () => {
      const c = gearClearance(ac);
      if (lift === null && !ac.onGround && c > 0.3) {
        lift = ac.pos.x - rw.start;
        liftKt = ac.ias * KT;
      }
      if (at15 === null && c > 15) at15 = ac.pos.x - rw.start;
    });
    if (ac.crashed) break;
  }
  const r = (v) => (v === null ? null : Math.round(v));
  return { crashed: ac.crashed ? ac.crashReason : false, lift: r(lift), liftKt, at15: r(at15) };
}

/** A child's take-off: full power and the stick held fully back from brake release. */
function yankTakeoff(id, rw, flaps) {
  const ac = make(id, 'simplified');
  ac.reset({ pos: new THREE.Vector3(rw.start, rw.elev, rw.z), headingDeg: 90, engineOn: true });
  ac.setFlaps(flaps);
  const tail = P.SPEC.hardPoints.find((h) => h.part === 'tail');
  let at15 = null;
  let minTail = Infinity;
  run(ac, 80, { throttle: 1, brakes: 0, pitch: 1, roll: 0, yaw: 0 }, () => {
    _w.copy(tail.pos).applyQuaternion(ac.quat).add(ac.pos);
    minTail = Math.min(minTail, _w.y - TER.heightAt(_w.x, _w.z));
    if (at15 === null && !ac.onGround && gearClearance(ac) > 15) at15 = ac.pos.x - rw.start;
  });
  return { crashed: ac.crashed ? ac.crashReason : false, at15: at15 === null ? null : Math.round(at15), minTail };
}

/** A landing down a 3 degree path at 1.3 × approach speed, full flap, idle at 12 m, full brakes; aiming 200 m in. */
function landing(id, rw) {
  const ac = make(id, 'simplified');
  const perf = T.performanceFor(id);
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
  for (let t = 0; t < 200 && stop === null; t += 1 / 30) {
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
    stopPastThreshold: stop === null ? null : stop - rw.x0,
    grade: ac.lastTouchdown && ac.lastTouchdown.quality,
  };
}

/** tests/playtest.js flyCircuit(), step for step, with the runway's own length as the pass mark. */
function playtestCircuit(id, rw) {
  const ac = make(id, 'simplified');
  ac.reset({ pos: new THREE.Vector3(rw.start, rw.elev, rw.z), headingDeg: 90, engineOn: true });
  const perf = T.performanceFor(id);
  const vr = perf.stallLanding * 1.25;
  ac.setFlaps(2);
  const o = { throttle: 1, brakes: 0, pitch: 0, roll: 0, yaw: 0 };
  let rollM = null;
  for (let t = 0; t < 90; t += 0.2) {
    if (ac.onGround) o.pitch = ac.ias * KT > vr ? 0.45 : 0;
    else o.pitch = Math.max(-0.5, Math.min(0.6, (10 - ac.pitchAngleDeg()) * 0.05));
    run(ac, 0.2, o);
    if (rollM === null && !ac.onGround && ac.agl > 15) rollM = Math.round(ac.pos.x - rw.x0);
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
  const t = T.getAircraft(id);
  const rw = runwayOf(id);
  // A giant is held to its own minimum, not to Gateway's whole length.
  const usable = t.minRunway || rw.len;
  const ahead = Math.min(rw.end - rw.start, usable - 80);
  // Standing still where it spawns: the height from its own gear.
  const ac = make(id, 'simplified');
  ac.reset({ pos: new THREE.Vector3(rw.start, rw.elev, rw.z), headingDeg: 90, engineOn: true });
  const y0 = ac.pos.y;
  const pitch0 = ac.pitchAngleDeg();
  const low = Math.min(...P.SPEC.gearPoints.map((g) => g.pos.y));
  run(ac, 5, { throttle: 0, pitch: 0, roll: 0, yaw: 0, brakes: 0 });
  ok(`${id}: spawns standing on its own wheels (height from its gear) and stays put`,
    !ac.crashed && ac.onGround && Math.abs(ac.pos.y - y0) < 0.05 && Math.abs(ac.pitchAngleDeg() - pitch0) < 0.3 && Math.abs(y0 - rw.elev + low) < 0.6,
    `${ac.crashed ? ac.crashReason : ''} y0 ${(y0 - rw.elev).toFixed(2)} m over the runway (gear ${low.toFixed(2)}), moved ${(ac.pos.y - y0).toFixed(3)} m, pitch ${pitch0.toFixed(2)} -> ${ac.pitchAngleDeg().toFixed(2)}`);

  const preset = FEATURE.TAKEOFF_FLAPS[id];
  const to = takeoff(id, rw);
  ok(`${id}: takes off within ${usable} m of runway (15 m up before its end)`, !to.crashed && to.at15 !== null && to.at15 < ahead,
    `${to.crashed || ''} lift-off ${to.lift} m at ${Math.round(to.liftKt)} kt, 15 m at ${to.at15} m from brake release`);
  const toReal = takeoff(id, rw, { mode: 'realistic' });
  ok(`${id}: takes off in realistic mode too`, !toReal.crashed && toReal.at15 !== null && toReal.at15 < ahead, `${toReal.crashed || ''} ${toReal.at15} m`);
  const toSet = takeoff(id, rw, { flaps: preset });
  ok(`${id}: takes off with the flap the game sets (${preset})`, !toSet.crashed && toSet.at15 !== null && toSet.at15 < ahead, `${toSet.crashed || ''} 15 m at ${toSet.at15} m`);
  for (const f of [0, preset]) {
    const y = yankTakeoff(id, rw, f);
    ok(`${id}: stick held fully back from brake release, flaps ${f}: flies before the runway ends, tail clear`,
      !y.crashed && y.at15 !== null && y.at15 < ahead && y.minTail > 0.3,
      `${y.crashed || ''} 15 m at ${y.at15} m, tail never closer than ${y.minTail.toFixed(2)} m`);
  }
  const ld = landing(id, rw);
  ok(`${id}: lands and stops within ${usable} m of the threshold`, !ld.crashed && ld.stopPastThreshold !== null && ld.stopPastThreshold < usable,
    `${ld.crashed || ''} ${Math.round(ld.from15)} m from 15 m, roll ${Math.round(ld.roll)} m, stopped ${Math.round(ld.stopPastThreshold)} m past the threshold (${ld.grade})`);
  const pc = playtestCircuit(id, rw);
  ok(`${id}: the playtest's circuit — take-off within ${usable} m`, !pc.crashed && pc.rollM !== null && pc.rollM <= usable, `${pc.crashed || ''} ${pc.rollM} m from the threshold`);
  ok(`${id}: the playtest's circuit — holds a 30-degree bank (22-55 deg)`, !pc.crashed && pc.maxBank >= 22 && pc.maxBank <= 55, `${pc.maxBank && pc.maxBank.toFixed(1)} deg`);
  ok(`${id}: the playtest's circuit — levels itself when you let go`, !pc.crashed && pc.bankAfter <= 8, `${pc.bankAfter && pc.bankAfter.toFixed(1)} deg after 10 s`);
  ok(`${id}: the playtest's circuit — sits at its approach speed`, !pc.crashed && pc.approachErr <= 22, `held ${pc.settled && pc.settled.toFixed(0)} kt`);
  if (t.minRunway) {
    // And it really is a giant: the Kestrel strip is not enough.
    const short = runwayOf(id, 'kestrel');
    const k = takeoff(id, short, { flaps: preset });
    ok(`${id}: needs more than the 1,100 m Kestrel strip (not 15 m up within its 1,020 m)`, k.crashed || k.at15 === null || k.at15 > short.end - short.start,
      `${k.crashed || ''} 15 m at ${k.at15} m`);
    runwayOf(id);
  }
  // A whole circuit with the scripted pilot the browser check uses (./circuit-pilot.js).
  {
    const ac2 = make(id, 'simplified');
    const runway = { x0: rw.x0, z0: rw.z, headingDeg: 90, length: rw.len, elev: rw.elev };
    ac2.reset({ pos: new THREE.Vector3(rw.start, rw.elev, rw.z), headingDeg: 90, engineOn: true });
    ac2.setFlaps(preset);
    const pilot = circuitPilot({ ac: ac2, runway, perf: T.performanceFor(id), giant: !!t.minRunway, heightAt: TER.heightAt, gear: (d) => { ac2.gearDown = d; }, flaps: (s) => ac2.setFlaps(s) });
    let secs = 0;
    while (!pilot.done && secs < 900) {
      const c = pilot.step(1 / 30);
      for (let k = 0; k < 4; k++) {
        Object.assign(ac2.controls, c);
        ac2.update(1 / 120, weather);
      }
      secs += 1 / 30;
      if (ac2.crashed) pilot.fail(`crashed: ${ac2.crashReason} (${pilot.phase})`);
    }
    if (!pilot.done) pilot.fail(`timed out (${pilot.phase})`);
    const S = pilot.state;
    ok(`${id}: flies a whole left-hand circuit and lands, stopping on the runway`,
      pilot.ok && S.stopAlong < usable && Math.abs(S.stopCross) < TER.AIRPORT.runway.halfWidth - 3,
      `${Math.round(secs)} s; ${pilot.log.slice(-3).join('; ')}`);
  }
  const wobble = handsOff(id, 280);
  ok(`${id}: hands-off at 280 kt holds its pitch`, wobble < 2, `${wobble.toFixed(2)} deg/s after 25 s`);
  report.push(`${id} (${rw.len} m): take-off ${to.at15} m to 15 m (lift-off ${to.lift} m, ${Math.round(to.liftKt)} kt; realistic ${toReal.at15} m; game's flaps ${preset} ${toSet.at15} m), landing ${Math.round(ld.from15)} m from 15 m (roll ${Math.round(ld.roll)} m)`);
}

console.log('\n' + report.join('\n'));
if (fails.length) console.log('\nFAILED:\n  ' + fails.join('\n  '));
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

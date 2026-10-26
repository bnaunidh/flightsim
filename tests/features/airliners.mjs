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
  /*
   * The budget was 9,000 for the pack's first drawing of these: three
   * cylinders of fuselage, a single tyre per leg and a pod per engine. The
   * exterior redo (src/fleet/extra/airliners.js) spends more on purpose —
   * the lofted nose, a six-pane flight deck in frames, high-bypass turbofans,
   * doors that open, and real undercarriage: eighteen or twenty-two wheels
   * with hubs, oleos, torque links and doors on a jumbo. Measured 7.0k on the
   * A320 and 13.4-13.5k on the 747 and A380; a hero model of that size draws
   * in well under a millisecond on the hangar's turntable (counted in
   * scratchpad/shots/airliners/*.json). 15,000 kept the lid on; the realism
   * layer (fleet/aircraft-realism.js: slats, spoilers, bay doors, a
   * translating sleeve per turbofan) adds 150-400 a type, and the A380 was
   * at 14,964 already, so the lid is 16,000 now.
   */
  ok(`${id}: under 16,000 triangles`, tris < 16000, `${Math.round(tris)}`);
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
 * The exterior (src/fleet/extra/airliners.js, airliner-kit.js): what the
 * owner asked for in "fix these parts of the airliners" — a real windscreen
 * set into the nose at the pilot's eye, even rounded windows in straight
 * rows on every deck, doors that are seams and open, twin-wheel nose gear
 * on a strut that reaches the ground, lamps on the real wing tips, and no
 * overlay that can z-fight the skin. Measured on the built model, not
 * asserted from the tables.
 * ------------------------------------------------------------------ */
const LIV = await import(SRC + 'aircraft/liveries.js');
const { AIRLINER_SPECS } = await import(SRC + 'fleet/extra/airliners.js');
const { loftFuselage, piecewise } = await import(SRC + 'fleet/extra/airliner-kit.js');

function meshesNamed(model, re) {
  const out = [];
  model.traverse((o) => {
    if (o.isMesh && re.test(o.name)) out.push(o);
  });
  return out;
}
/** Instance placements of an instanced mesh, in the model's frame. */
function instancesOf(mesh, model) {
  mesh.updateWorldMatrix(true, false);
  const inv = new THREE.Matrix4().copy(model.matrixWorld).invert();
  const m = new THREE.Matrix4();
  const p = new THREE.Vector3();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  const out = [];
  for (let i = 0; i < mesh.count; i++) {
    mesh.getMatrixAt(i, m);
    m.premultiply(mesh.matrixWorld).premultiply(inv).decompose(p, q, s);
    out.push({ x: p.x, y: p.y, z: p.z, sx: s.x, sy: s.y });
  }
  return out;
}
/** The lowest vertex of a mesh (every instance of an instanced one), in the model's frame. */
function lowestOf(mesh, model) {
  mesh.updateWorldMatrix(true, false);
  const inv = new THREE.Matrix4().copy(model.matrixWorld).invert();
  const pos = mesh.geometry.attributes.position;
  const v = new THREE.Vector3();
  const m = new THREE.Matrix4();
  let low = Infinity;
  const mats = [];
  if (mesh.isInstancedMesh) for (let i = 0; i < mesh.count; i++) mats.push(new THREE.Matrix4().copy((mesh.getMatrixAt(i, m), m)));
  else mats.push(new THREE.Matrix4());
  for (const im of mats) {
    const full = new THREE.Matrix4().copy(mesh.matrixWorld).multiply(im).premultiply(inv);
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(full);
      if (v.y < low) low = v.y;
    }
  }
  return low;
}
const r2 = (v) => +v.toFixed(2);

for (const id of IDS) {
  const type = T.getAircraft(id);
  const model = ADAPTER.createAircraftModel({ type });
  model.updateMatrixWorld(true);
  const fg = model.userData.flightGeometry;
  const S = AIRLINER_SPECS[id];
  const g = AIRLINER_GEOMETRY[id];
  const spec = T.specFor(id);

  /* The flight deck: six panes in frames with wipers, published for the
   * cockpit, and the windscreens straddle the eye's height and end just
   * ahead of it — so from the seat, the glass is where the view out is. */
  const fd = model.userData.flightDeck;
  const panes = fd ? fd.panes : [];
  ok(`${id}: a six-pane flight deck in black frames, with wipers, published for the cockpit`,
    panes.length === 6 && panes.every((p) => p.corners.length === 4 && p.corners.flat().every(Number.isFinite))
      && meshesNamed(model, /^Windscreen frames$/).length === 1 && meshesNamed(model, /^Flight deck glass$/).length === 1
      && meshesNamed(model, /^Windscreen wipers$/).length === 1,
    `${panes.length} panes`);
  const ws = panes.filter((p) => /^Windscreen/.test(p.name));
  const wy = ws.flatMap((p) => p.corners.map((c) => c[1]));
  const wz = ws.flatMap((p) => p.corners.map((c) => c[2]));
  const eye = fg.eye;
  const aft = eye[2] - Math.max(...wz);
  ok(`${id}: the windscreen is set at the pilot's eye — its height inside the panes, the glass 0.3-2 m ahead`,
    ws.length === 2 && Math.min(...wy) < eye[1] && Math.max(...wy) > eye[1] && aft > 0.3 && aft < 2,
    `panes y ${r2(Math.min(...wy))}..${r2(Math.max(...wy))}, eye y ${eye[1]}, glass ${r2(aft)} m ahead of the eye`);

  /* Cabin windows: instanced draws of rounded (alpha-tested) panes — one per
   * breakaway piece of the fuselage that carries any, never one per window —
   * and every row — the 747's upper deck and the A380's two decks included —
   * is straight and at one pitch, gaps only where a door is. */
  const wins = meshesNamed(model, /^Cabin window rows$/);
  const wm = wins[0];
  const winCount = wins.reduce((n, w) => n + w.count, 0);
  ok(`${id}: cabin windows are a few instanced draws of rounded panes (one per fuselage piece), not one per window`,
    wins.length >= 1 && wins.length <= 3 && wins.every((w) => w.isInstancedMesh && !!w.material.map && w.material.alphaTest > 0) && winCount > 40,
    `${wins.length} draw(s), ${winCount} windows`);
  /* Every pane hangs from the piece of skin it sits on (the nose, the cabin
   * or the tail cone, cut at F.cuts), so when a piece comes off in a crash
   * its windows go with it. They were all on the cabin piece once, and a
   * tail strike left a dashed row of dark panes hanging in the air behind
   * the broken end. */
  {
    const F = S.fuselage;
    const span = { nose: [-Infinity, F.cuts[0]], fuselage: [F.cuts[0], F.cuts[1]], tail: [F.cuts[1], Infinity] };
    const pieces = model.userData.strikePoints || {};
    const pieceOf = (o) => {
      for (let n = o; n; n = n.parent) for (const key of ['nose', 'fuselage', 'tail']) if (pieces[key] && pieces[key].nodes.includes(n)) return key;
      return null;
    };
    const bad = [];
    const where = [];
    for (const w of wins) {
      const key = pieceOf(w);
      const zs = instancesOf(w, model).map((p) => p.z);
      where.push(`${key || 'no piece'} ${w.count} (z ${r2(Math.min(...zs))}..${r2(Math.max(...zs))})`);
      if (!key) { bad.push(`${w.count} panes on no breakaway piece`); continue; }
      const [lo, hi] = span[key];
      const out = zs.filter((z) => z < lo - 1e-6 || z > hi + 1e-6);
      if (out.length) bad.push(`${out.length} pane(s) on the ${key} piece lie outside its skin (z ${r2(Math.min(...out))}..${r2(Math.max(...out))}, piece ${r2(lo)}..${r2(hi)})`);
    }
    const expectTail = S.windows.some((r) => Math.max(r.z0, r.z1) > F.cuts[1]);
    const expectNose = S.windows.some((r) => Math.min(r.z0, r.z1) < F.cuts[0]);
    const keys = new Set(wins.map(pieceOf));
    if (expectTail && !keys.has('tail')) bad.push('the rows run past the tail cut but no draw hangs from the tail piece');
    if (expectNose && !keys.has('nose')) bad.push('the rows run forward of the nose cut but no draw hangs from the nose piece');
    ok(`${id}: every cabin window hangs from the fuselage piece it sits on, ready to break away with it`,
      bad.length === 0, bad.join('; ') || where.join(', '));
  }
  if (wm) {
    const inst = wins.flatMap((w) => instancesOf(w, model));
    const bad = [];
    let rows = 0;
    for (const row of S.windows) {
      for (const side of [-1, 1]) {
        const mine = inst.filter((w) => Math.sign(w.x) === side && Math.abs(w.y - row.y) < 0.08).sort((a, b) => a.z - b.z);
        rows++;
        if (mine.length < 8) {
          bad.push(`${row.deck || 'main'} ${side < 0 ? 'left' : 'right'}: only ${mine.length} windows`);
          continue;
        }
        const ys = mine.map((w) => w.y);
        if (Math.max(...ys) - Math.min(...ys) > 0.07) bad.push(`${row.deck || 'main'} row wanders ${r2(Math.max(...ys) - Math.min(...ys))} m`);
        const gaps = mine.slice(1).map((w, i) => w.z - mine[i].z);
        if (Math.abs(Math.min(...gaps) - row.pitch) > 0.02) bad.push(`${row.deck || 'main'} pitch ${r2(Math.min(...gaps))}, wanted ${row.pitch}`);
        const off = gaps.filter((gp) => Math.abs(gp / row.pitch - Math.round(gp / row.pitch)) > 0.08);
        if (off.length) bad.push(`${row.deck || 'main'}: ${off.length} gap(s) off the pitch`);
        if (mine.some((w) => Math.abs(w.sx - row.w) > 0.01 || Math.abs(w.sy - row.ht) > 0.01)) bad.push(`${row.deck || 'main'}: window sizes vary`);
      }
    }
    ok(`${id}: ${rows / 2} window row(s) straight and evenly spaced on each side${S.windows.some((r) => r.deck === 'upper') || S.windows.length > 1 ? ', the upper deck included' : ''}`,
      bad.length === 0, bad.join('; '));
  }

  /* Doors: every one of the table, both sides alike, closed by default
   * (nothing drawn but the painted seam), and they open. */
  const doors = model.userData.doors;
  {
    const list = doors ? doors.list : [];
    const left = list.filter((d) => d.side === 'left').length;
    const right = list.filter((d) => d.side === 'right').length;
    const leafOf = (d) => {
      const n = doors.node(d.id);
      let leaf = null;
      if (n) n.traverse((o) => { if (o.name === `Door ${d.id} leaf`) leaf = o; });
      return leaf;
    };
    const shut = list.every((d) => leafOf(d) && !leafOf(d).visible);
    if (doors) doors.open('all', { instant: true });
    const opened = list.every((d) => leafOf(d) && leafOf(d).visible && Math.abs(leafOf(d).rotation.y) > 1);
    if (doors) doors.close('all', { instant: true });
    const shutAgain = list.every((d) => !leafOf(d).visible);
    const where = list.every((d) => Number.isFinite(d.x) && Number.isFinite(d.y) && Number.isFinite(d.z) && d.sill < d.y && Math.abs(d.x) > 1);
    ok(`${id}: ${list.length} doors, the same on both sides, shut by default (a painted seam), and they swing open`,
      list.length === S.doors.length && left === right && shut && opened && shutAgain && where,
      `${left} left, ${right} right; shut ${shut}, opened ${opened}, shut again ${shutAgain}`);
  }

  /* Undercarriage: twin tyres on the nose leg — on a strut with an oleo,
   * torque links, a drag brace and its doors — and the tyres of every leg
   * rest on the contact point the physics lands on. */
  {
    const twins = meshesNamed(model, /^Twin tyres$/);
    const noseTyres = twins.find((m) => Math.abs(new THREE.Vector3().setFromMatrixPosition(m.matrixWorld).x) < 0.3);
    const noseLeg = (() => {
      for (let p = noseTyres; p; p = p.parent) if (/^Nose landing gear$/i.test(p.name)) return p;
      return null;
    })();
    /*
     * The pack core bakes a part's static meshes that share a material into
     * one "surface assembly", so the oleo cylinder, collar, torque links,
     * pin and drag brace arrive as one gear-metal mesh (184 triangles on the
     * 747; the core's bare strut alone is 24) and the two bay doors as one
     * in the nacelle paint. The axle through both wheels stays its own mesh
     * inside the steering group, as it turns with it.
     */
    const triCount = (m) => (m.geometry.index ? m.geometry.index.count : m.geometry.attributes.position.count) / 3;
    let linkage = 0;
    let doorsTris = 0;
    let axle = null;
    if (noseLeg) noseLeg.traverse((o) => {
      if (!o.isMesh || o.isInstancedMesh) return;
      if (/surface assembly/.test(o.name) && /gear_metal/.test(o.material.name)) linkage += triCount(o);
      if (/surface assembly/.test(o.name) && /nacelle/.test(o.material.name)) doorsTris += triCount(o);
      if (o.name === 'Axle') axle = o;
    });
    const nosePt = spec.gearPoints.find((p) => p.name === 'nose');
    const low = noseTyres ? lowestOf(noseTyres, model) : NaN;
    ok(`${id}: twin nose wheels on an axle, on a strut with an oleo, torque links, a drag brace and two bay doors`,
      !!noseTyres && noseTyres.count === 2 && !!noseLeg && !!axle && linkage >= 150 && doorsTris >= 24,
      noseTyres ? `${noseTyres.count} tyres; ${linkage} triangles of linkage, ${doorsTris} of doors, axle ${!!axle}` : 'no twin tyres at x 0');
    ok(`${id}: the nose tyres rest on the physics' nose contact point`, Math.abs(low - nosePt.pos.y) < 0.03,
      `tyres ${r2(low)} m, physics ${r2(nosePt.pos.y)} m`);
    // The main legs: a pair or a bogie each, their lowest tyre on the main contact point.
    const mainPt = spec.gearPoints.find((p) => p.name === 'right');
    const mains = [];
    model.traverse((o) => {
      if (!o.isInstancedMesh || !/tyres$/i.test(o.name)) return;
      const x = new THREE.Vector3().setFromMatrixPosition(o.matrixWorld).x;
      if (Math.abs(x) > 1) mains.push(o);
    });
    const mainLow = mains.map((m) => lowestOf(m, model));
    const legs = mains.length;
    const wantLegs = { a320: 2, b747: 4, a380: 4 }[id];
    ok(`${id}: ${wantLegs} main legs, every tyre set on the physics' main contact point`,
      legs === wantLegs && mainLow.every((y) => Math.abs(y - mainPt.pos.y) < 0.03) && mains.every((m) => m.count >= 2),
      `${legs} legs at ${mainLow.map(r2).join(', ')} m; physics ${r2(mainPt.pos.y)} m`);
  }

  /* Every overlay on the skin is a decal with a polygon offset, so none can
   * trade the depth test with the skin from a few hundred metres (the
   * strobing on the traffic). The fin paint and the door openings too. */
  {
    const overlays = meshesNamed(model, /^(Windscreen frames|Flight deck glass|Windscreen wipers|Cabin window rows|Airframe registration|Painted fin|Painted rudder|Titling)$|^Door .* opening$/);
    const plain = overlays.filter((m) => !(m.material.polygonOffset === true && m.material.polygonOffsetFactor < 0));
    ok(`${id}: every overlay on the skin carries the decal polygon offset (${overlays.length} of them)`,
      overlays.length >= 8 && plain.length === 0, plain.map((m) => m.name).join(', '));
  }

  /* The painted-on words stand clear of the skin. The registration (and a
   * scheme's titling line) are patches laid on the loft: every vertex has
   * to sit 2-5 cm proud of the analytic surface, and the patch needs rows
   * enough across that it does not cut a chord through the facets — one
   * row over a 1.2 m band on a 3.3 m tube sagged 5 cm inside, and the
   * number on every type was buried in the hull's own facets. */
  {
    const F = S.fuselage;
    const h = loftFuselage({ ...F, along: piecewise(F.alongKnots) });
    const P = new THREE.Vector3();
    const N = new THREE.Vector3();
    const v = new THREE.Vector3();
    const words = meshesNamed(model, /^(Airframe registration|Titling)$/);
    const bad = [];
    let rows = Infinity;
    for (const m of words) {
      m.updateWorldMatrix(true, false);
      const inv = new THREE.Matrix4().copy(model.matrixWorld).invert();
      const full = new THREE.Matrix4().copy(m.matrixWorld).premultiply(inv);
      const pos = m.geometry.attributes.position;
      // Columns of the patch: its z values clustered (the normal offset
      // shifts a row's z by millimetres on a tapered section; columns are
      // 20 cm or more apart).
      const zs = [];
      let worst = [Infinity, -Infinity];
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i).applyMatrix4(full);
        if (!zs.some((z) => Math.abs(z - v.z) < 0.1)) zs.push(v.z);
        // The surface point at this vertex's height on its side, and how far out along the normal the vertex is.
        const s = h.angleAt(v.z, v.y) * Math.sign(v.x || 1);
        h.point(v.z, s, P);
        h.normal(v.z, s, N);
        const out = v.clone().sub(P).dot(N);
        worst = [Math.min(worst[0], out), Math.max(worst[1], out)];
      }
      rows = Math.min(rows, pos.count / zs.length);
      if (worst[0] < 0.02 || worst[1] > 0.06) bad.push(`${m.name}: ${r2(worst[0] * 100)}..${r2(worst[1] * 100)} cm off the surface`);
    }
    ok(`${id}: the registration stands 2-6 cm proud of the lofted skin, in rows fine enough not to sag into its facets`,
      words.length >= 2 && bad.length === 0 && rows >= 5, bad.join('; ') || `${words.length} patches, ${rows} rows across`);
  }

  /* The lamps: where the model says they go (userData.lamps) — the nav
   * lights on the real wing tips, the beacon on the crown, the tail light
   * on the end of the cone — and the adapter hung its sprites there. */
  {
    const lamps = model.userData.lamps || {};
    const sprites = model.children.filter((o) => o.isSprite);
    const at = (k) => Array.isArray(lamps[k]) && sprites.some((s) => s.position.distanceTo(new THREE.Vector3(...lamps[k])) < 0.01);
    // The crown at the beacon's own station: the main tube's top there, or
    // the hump's where the hump covers it (the 747's beacon is aft of it).
    const topAt = (stations, z) => {
      const st = stations.filter((q) => Number.isFinite(q.top)).sort((a, b) => a.z - b.z);
      if (z <= st[0].z || z >= st[st.length - 1].z) return -Infinity;
      for (let i = 0; i < st.length - 1; i++) {
        if (z <= st[i + 1].z) return st[i].top + ((st[i + 1].top - st[i].top) * (z - st[i].z)) / (st[i + 1].z - st[i].z || 1);
      }
      return -Infinity;
    };
    const bz = lamps.beacon ? lamps.beacon[2] : 0;
    const top = Math.max(topAt(S.fuselage.stations, bz), S.hump ? topAt(S.hump.stations, bz) : -Infinity);
    const tailZ = S.fuselage.stations[S.fuselage.stations.length - 1].z;
    ok(`${id}: navigation lights on the wing tips, the beacon on the crown, the tail light on the cone — and the sprites hang there`,
      lamps.navLeft && Math.abs(lamps.navLeft[0] + g.tip.x) < 0.1 && Math.abs(lamps.navRight[0] - g.tip.x) < 0.1
        && lamps.beacon && lamps.beacon[1] > top - 0.2 && lamps.tail && lamps.tail[2] > tailZ - 0.5
        && ['navLeft', 'navRight', 'beacon', 'tail', 'strobeL', 'strobeR', 'landing'].every(at),
      `nav x ${lamps.navLeft && r2(lamps.navLeft[0])} / tip ${g.tip.x}; beacon y ${lamps.beacon && r2(lamps.beacon[1])} / crown ${r2(top)}; tail z ${lamps.tail && r2(lamps.tail[2])} / cone end ${tailZ}`);
  }

  /* The skin is one picture: the three breakaway pieces share one livery
   * material, and the texture's u runs on from the nose piece into the cabin
   * piece into the tail — so the cheatline cannot stop at a joint. */
  {
    // The pieces by their material (the pack core bakes each part's skin
    // with whatever else wears the livery there — the upper deck, the
    // fairing — into one "surface assembly"); the door leaves are dynamic
    // and wear the same paint, but are not the fuselage.
    const skins = [];
    model.traverse((o) => {
      if (o.isMesh && !o.isInstancedMesh && !o.userData.dynamic && o.material.name === 'Airliner_livery') skins.push(o);
    });
    const ranges = skins.map((m) => {
      const uv = m.geometry.attributes.uv;
      let lo = Infinity;
      let hi = -Infinity;
      for (let i = 0; i < uv.count; i++) {
        const u = uv.getX(i);
        if (u < lo) lo = u;
        if (u > hi) hi = u;
      }
      return [lo, hi];
    }).sort((a, b) => a[0] - b[0]);
    const joined = ranges.length === 3 && ranges[0][0] < 0.01 && ranges[2][1] > 0.99
      && Math.abs(ranges[0][1] - ranges[1][0]) < 0.01 && Math.abs(ranges[1][1] - ranges[2][0]) < 0.01;
    ok(`${id}: the fuselage is one livery in three breakaway pieces (one material, the paint running on across the joints)`,
      skins.length === 3 && skins.every((m) => m.material === skins[0].material) && !!skins[0].material.map && joined,
      ranges.map((r) => `${r2(r[0])}..${r2(r[1])}`).join(' | '));
  }

  /* Draw calls: merged geometry and shared materials. A mesh is a draw. The
   * old pack drawing was 50/65/66 meshes; the redo's undercarriage and
   * flight deck cost more on purpose (79/112/124 measured) — these are the
   * lids, so nothing creeps towards a draw per window. */
  {
    let meshes = 0;
    const mats = new Set();
    model.traverse((o) => {
      if (!o.isMesh) return;
      meshes++;
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) mats.add(m.uuid);
    });
    // The realism layer (fleet/aircraft-realism.js) hangs a hinge group per
    // moving part — two spoiler sets, two slats, four bay doors, a reverser
    // sleeve per turbofan, one heat haze — so each lid carries ten more.
    // The fan cowls wear their own skin (airliner-kit cowlTexture: the
    // airline's cowl colour, ring and grime): one more material, and one
    // more draw per engine, so the four-engined lids carry four more.
    const lid = { a320: 102, b747: 139, a380: 149 }[id];
    ok(`${id}: under ${lid} draws and 27 materials`, meshes < lid && mats.size <= 27, `${meshes} meshes, ${mats.size} materials`);
  }

  /* The crash itself, through the same strike() the game's impact() calls:
   * when the tail cone (or, on the 747, the nose with its upper-deck row)
   * comes off, its windows leave with it and none is left hanging in the air
   * beyond the broken end of the cabin piece. Last on purpose: strike hides
   * the lost pieces, and everything above measured the whole aeroplane. */
  {
    const F = S.fuselage;
    const debris = new THREE.Scene();
    const hit = { debrisParent: debris, groundHeight: 0, lifetime: 20, worldVelocity: { x: 0, y: -1, z: -70 }, worldAngularVelocity: { x: 0, y: 0, z: 0 } };
    const panesIn = (root) => {
      let n = 0;
      root.traverse((o) => { if (o.isInstancedMesh && o.name === 'Cabin window rows') n += o.count; });
      return n;
    };
    const left = () => {
      const zs = [];
      model.traverseVisible((o) => { if (o.isInstancedMesh && o.name === 'Cabin window rows') zs.push(...instancesOf(o, model).map((p) => p.z)); });
      return zs;
    };
    const before = left().length;
    const tail = model.userData.strike('tail', hit);
    const carried = tail && tail.body ? panesIn(tail.body.visual) : 0;
    const after = left();
    const hanging = after.filter((z) => z > F.cuts[1] + 1e-6).length;
    ok(`${id}: when the tail breaks off its windows go with it — none left hanging behind the cabin's broken end`,
      !!tail && carried > 0 && hanging === 0 && after.length + carried === before,
      `${carried} panes on the tail piece, ${after.length} left on the aeroplane, ${hanging} beyond the cut at z ${F.cuts[1]}`);
    if (S.windows.some((r) => Math.min(r.z0, r.z1) < F.cuts[0])) {
      const nose = model.userData.strike('nose', hit);
      const carriedN = nose && nose.body ? panesIn(nose.body.visual) : 0;
      const afterN = left();
      const hangingN = afterN.filter((z) => z < F.cuts[0] - 1e-6).length;
      ok(`${id}: when the nose breaks off its upper-deck windows go with it`,
        !!nose && carriedN > 0 && hangingN === 0 && afterN.length + carriedN === after.length,
        `${carriedN} panes on the nose piece, ${afterN.length} left, ${hangingN} ahead of the cut at z ${F.cuts[0]}`);
    }
  }
  model.userData.dispose();
}

/* The pack's Meridian (Settings' "alternative models for every aeroplane",
 * fleet/aircraft-transport.js) is dressed by the same kit: its window row
 * runs half a metre past the tail cut, and those panes must break away with
 * the tail cone too. */
{
  ADAPTER.setFleetModels(true);
  let model;
  try {
    model = ADAPTER.createAircraftModel({ type: T.getAircraft('meridian') });
  } finally {
    ADAPTER.setFleetModels(false);
  }
  model.updateMatrixWorld(true);
  const wins = meshesNamed(model, /^Cabin window rows$/);
  const pieces = model.userData.strikePoints || {};
  const pieceOf = (o) => {
    for (let n = o; n; n = n.parent) for (const key of ['nose', 'fuselage', 'tail']) if (pieces[key] && pieces[key].nodes.includes(n)) return key;
    return null;
  };
  const onTail = wins.filter((w) => pieceOf(w) === 'tail');
  const tailZ = onTail.flatMap((w) => instancesOf(w, model).map((p) => p.z));
  const cabinZ = wins.filter((w) => pieceOf(w) === 'fuselage').flatMap((w) => instancesOf(w, model).map((p) => p.z));
  const cut = 6.5; // MERIDIAN.fuselage.cuts[1]
  const hit = { debrisParent: new THREE.Scene(), groundHeight: 0, lifetime: 20, worldVelocity: { x: 0, y: -1, z: -70 }, worldAngularVelocity: { x: 0, y: 0, z: 0 } };
  const tail = model.userData.strike('tail', hit);
  let carried = 0;
  if (tail) tail.body.visual.traverse((o) => { if (o.isInstancedMesh && o.name === 'Cabin window rows') carried += o.count; });
  const left = [];
  model.traverseVisible((o) => { if (o.isInstancedMesh && o.name === 'Cabin window rows') left.push(...instancesOf(o, model).map((p) => p.z)); });
  ok("pack Meridian (alternative models on): the panes aft of the tail cut hang from the tail cone and leave with it when it breaks off",
    wins.length === 2 && onTail.length === 1 && tailZ.length > 0 && tailZ.every((z) => z > cut) && cabinZ.every((z) => z <= cut)
      && !!tail && carried === tailZ.length && left.every((z) => z <= cut),
    `${wins.length} draws; ${tailZ.length} pane(s) on the tail at z ${tailZ.length ? r2(Math.min(...tailZ)) : '-'}..${tailZ.length ? r2(Math.max(...tailZ)) : '-'}, cut ${cut}; ${carried} carried off, ${left.filter((z) => z > cut).length} left hanging`);
  model.userData.dispose();
}

/* Through the game's own crash entry — crashAircraftModel (model-adapter) →
 * beginGameAircraftCrash → impact(), which CRUSHES the struck section
 * (damagePart, from severity 0.32) before anything comes off, and only then
 * strike()s it. The redo's first window fix went through strike() alone and
 * missed that: the skin concertinaed and the panes, instanced, stayed where
 * the skin had been — a dashed row of dark squares in the air beside the
 * wreck — and the windscreen sat 2 m off the crushed nose. So, after each of
 * the three crashes the game names, every visible pane (on the aeroplane and
 * on each piece that came off) sits on a visible triangle of its own body's
 * skin, and the flight deck glass, its frames and the door leaves do too.
 *
 * skinFit(root): the worst distance, in metres, from each kind of thing laid
 * on the skin to the nearest visible livery triangle of the same body. */
function skinFit(root) {
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const shown = (o) => {
    for (let n = o; n && n !== root.parent; n = n.parent) if (!n.visible) return false;
    return true;
  };
  const rel = new THREE.Matrix4();
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  // The skin's triangles, filed under every 2 m of z they span.
  const tris = [];
  const shelf = new Map();
  const slot = (z) => Math.floor(z / 2);
  root.traverse((o) => {
    if (!o.isMesh || o.isInstancedMesh || !shown(o) || !o.material || o.material.name !== 'Airliner_livery' || /^Door/.test(o.name)) return;
    rel.multiplyMatrices(inv, o.matrixWorld);
    const pos = o.geometry.attributes.position;
    const idx = o.geometry.index;
    const n = idx ? idx.count : pos.count;
    for (let i = 0; i < n; i += 3) {
      a.fromBufferAttribute(pos, idx ? idx.getX(i) : i).applyMatrix4(rel);
      b.fromBufferAttribute(pos, idx ? idx.getX(i + 1) : i + 1).applyMatrix4(rel);
      c.fromBufferAttribute(pos, idx ? idx.getX(i + 2) : i + 2).applyMatrix4(rel);
      const t = new THREE.Triangle(a.clone(), b.clone(), c.clone());
      tris.push(t);
      for (let k = slot(Math.min(a.z, b.z, c.z)); k <= slot(Math.max(a.z, b.z, c.z)); k++) {
        if (!shelf.has(k)) shelf.set(k, []);
        shelf.get(k).push(t);
      }
    }
  });
  const tmp = new THREE.Vector3();
  const gap = (p) => {
    let best = Infinity;
    const k0 = slot(p.z);
    for (let k = k0 - 1; k <= k0 + 1; k++) for (const t of shelf.get(k) || []) best = Math.min(best, t.closestPointToPoint(p, tmp).distanceTo(p));
    if (best === Infinity) for (const t of tris) best = Math.min(best, t.closestPointToPoint(p, tmp).distanceTo(p)); // far off: say how far
    return best;
  };
  const out = { tris: tris.length, panes: 0, pane: 0, glass: 0, frames: 0, doors: 0 };
  const m = new THREE.Matrix4();
  root.traverse((o) => {
    if (!o.isMesh || !shown(o)) return;
    rel.multiplyMatrices(inv, o.matrixWorld);
    if (o.isInstancedMesh && o.name === 'Cabin window rows') {
      for (let i = 0; i < o.count; i++) {
        o.getMatrixAt(i, m);
        out.panes++;
        out.pane = Math.max(out.pane, gap(a.setFromMatrixPosition(m.premultiply(rel))));
      }
      return;
    }
    const key = o.name === 'Flight deck glass' ? 'glass' : o.name === 'Windscreen frames' ? 'frames' : /^Door .* skin$/.test(o.name) ? 'doors' : null;
    if (!key || o.isInstancedMesh) return;
    const pos = o.geometry.attributes.position;
    const step = Math.max(1, Math.floor(pos.count / 40));
    for (let i = 0; i < pos.count; i += step) out[key] = Math.max(out[key], gap(a.fromBufferAttribute(pos, i).applyMatrix4(rel)));
  });
  return out;
}
const worstOf = (fit) => Math.max(fit.pane, fit.glass, fit.frames, fit.doors);
const fitText = (fit) => `${fit.panes} panes ${r2(fit.pane)} m, glass ${r2(fit.glass)}, frames ${r2(fit.frames)}, doors ${r2(fit.doors)} (${fit.tris} skin triangles)`;

/** Crash a freshly built aeroplane the way main.js does, and look at what is left 20 frames on. */
function gameCrash(id, reason, { fleet = false } = {}) {
  if (fleet) ADAPTER.setFleetModels(true);
  let model;
  try {
    model = ADAPTER.createAircraftModel({ type: T.getAircraft(id) });
  } finally {
    if (fleet) ADAPTER.setFleetModels(false);
  }
  const scene = new THREE.Scene();
  scene.add(model);
  model.position.set(0, 14, 0);
  model.quaternion.identity();
  model.updateMatrixWorld(true);
  const intact = skinFit(model);
  const ac = { pos: model.position.clone(), quat: model.quaternion.clone(), vel: new THREE.Vector3(0, -1, -70), omega: new THREE.Vector3(), crashed: true, controls: {} };
  const began = ADAPTER.crashAircraftModel(model, ac, { reason, worldVelocity: ac.vel.clone(), worldAngularVelocity: new THREE.Vector3(), worldPoint: model.position.clone() }, { groundHeight: 0 });
  const report = model.userData.gameCrash && model.userData.gameCrash.report;
  for (let i = 0; i < 20; i++) model.userData.update(1 / 60, ac, {});
  const bodies = [{ name: 'the aeroplane', fit: skinFit(model) }];
  for (const p of model.userData.partBodies) if (p.active) bodies.push({ name: `the ${p.id} piece`, fit: skinFit(p.visual) });
  model.userData.dispose();
  model.removeFromParent();
  return { began, intact, action: report && report.action, severity: report ? report.accumulatedSeverity : 0, part: report && report.partId, bodies };
}

const CRASHES = ['The tail struck the ground', 'The nose struck the ground', 'Hit the ground'];
for (const [id, fleet] of [...IDS.map((i) => [i, false]), ['meridian', true]]) {
  const name = fleet ? 'pack Meridian' : id;
  for (const reason of CRASHES) {
    const r = gameCrash(id, reason, { fleet });
    const sane = r.began && worstOf(r.intact) < 0.1 && r.intact.panes > 40;
    // The crush ran (severity 0.32 and up), and a tail or nose strike took that section off.
    const struck = r.severity >= 0.32 && (reason === 'Hit the ground' ? r.part === 'fuselage' : r.action === 'detach' && r.bodies.length === 2);
    const worst = Math.max(...r.bodies.map((b) => worstOf(b.fit)));
    const stayed = r.bodies.reduce((n, b) => n + b.fit.panes, 0) === r.intact.panes;
    ok(`${name}: "${reason}" through the game's crash entry (${r.action} ${r.part} at ${r2(r.severity)}): every window pane, the windscreen and the doors stay on the crushed skin, on the aeroplane and on what came off (worst ${r2(worst)} m)`,
      sane && struck && stayed && worst <= 0.3,
      r.bodies.map((b) => `${b.name}: ${fitText(b.fit)}`).join('; ') + (sane ? '' : ` — intact: ${fitText(r.intact)}`));
  }
}

/* A crash that names no part. main.js hands the bridge `c.contact && c.contact.part`,
 * which is null when there is no contact; the bridge passed that null on, and
 * impact() threw "Unknown impact part null" — "The fleet crash could not start"
 * in the self-test's console, on the pack aeroplanes. No part is "find the
 * nearest one", the same as undefined. */
{
  ADAPTER.setFleetModels(true);
  let model;
  try {
    model = ADAPTER.createAircraftModel({ type: T.getAircraft('meridian') });
  } finally {
    ADAPTER.setFleetModels(false);
  }
  const scene = new THREE.Scene();
  scene.add(model);
  model.position.set(0, 14, 0);
  model.updateMatrixWorld(true);
  const ac = { pos: model.position.clone(), quat: model.quaternion.clone(), vel: new THREE.Vector3(0, -1, -70), omega: new THREE.Vector3(), crashed: true, controls: {} };
  let err = null;
  let began = false;
  const warn = console.warn;
  console.warn = (...a) => { err = err || a.map(String).join(' '); };
  try {
    began = ADAPTER.crashAircraftModel(model, ac, { reason: 'You flew into the control tower', partId: null, worldVelocity: ac.vel.clone(), worldAngularVelocity: new THREE.Vector3(), worldPoint: model.position.clone() }, { groundHeight: 0 });
  } catch (e) {
    err = String(e && e.message);
  } finally {
    console.warn = warn;
  }
  const report = model.userData.gameCrash && model.userData.gameCrash.report;
  ok('pack Meridian: a crash with no part named (partId null) starts the fleet crash at the nearest part, without "Unknown impact part"',
    began && !!report && !err, err || `${report && report.action} ${report && report.partId}`);
  model.userData.dispose();
  model.removeFromParent();
}

/* A crash with no contact at all: main.js hands over a null point AND a null
 * part (an overspeed break-up, a Dev or mission crash). There is nothing to be
 * "nearest" to, and the search through every part plus the strike cost
 * 31-39 ms on the A380's crash frame (crash-freeze.browser.js), so the pack's
 * impact is skipped, as v74.1 did — but quietly now, with no "could not start"
 * warning, and the fleet crash state still begins. */
{
  ADAPTER.setFleetModels(true);
  let model;
  try {
    model = ADAPTER.createAircraftModel({ type: T.getAircraft('meridian') });
  } finally {
    ADAPTER.setFleetModels(false);
  }
  const scene = new THREE.Scene();
  scene.add(model);
  model.position.set(0, 14, 0);
  model.updateMatrixWorld(true);
  const ac = { pos: model.position.clone(), quat: model.quaternion.clone(), vel: new THREE.Vector3(0, -1, -70), omega: new THREE.Vector3(), crashed: true, controls: {} };
  let err = null;
  let began = false;
  const warn = console.warn;
  console.warn = (...a) => { err = err || a.map(String).join(' '); };
  try {
    began = ADAPTER.crashAircraftModel(model, ac, { reason: 'Crash with no contact', partId: null, worldPoint: null, worldVelocity: ac.vel.clone(), worldAngularVelocity: new THREE.Vector3() }, { groundHeight: 0 });
  } catch (e) {
    err = String(e && e.message);
  } finally {
    console.warn = warn;
  }
  const report = model.userData.gameCrash && model.userData.gameCrash.report;
  ok('pack Meridian: a crash with no contact (point and part null) begins the fleet crash and skips the pack impact, with no warning',
    began && !err && !!report && report.ignored === true && report.reason === 'no contact', err || JSON.stringify(report));
  model.userData.dispose();
  model.removeFromParent();
}

/* Air Force One: the 747 in the 'potus' scheme (aircraft/liveries.js) keeps
 * its look — white over the scheme's blue band and line, the dark blue fin,
 * SAM 42, and the titling line, which the pack's old skin painted and the
 * redo must too, readable from both sides. */
{
  const type = T.getAircraft('b747');
  const scheme = LIV.schemeFor(type, 'potus');
  const model = ADAPTER.createAircraftModel({ type, livery: scheme });
  model.updateMatrixWorld(true);
  const fin = meshesNamed(model, /^Painted fin$/)[0];
  const finOk = !!fin && fin.material.color.getHex() === new THREE.Color(scheme.tail).getHex();
  let skin = null;
  model.traverse((o) => { if (!skin && o.isMesh && o.material.name === 'Airliner_livery') skin = o; });
  const skinOk = !!skin && !!skin.material.map && String(skin.material.map.name).includes(scheme.base) && String(skin.material.map.name).includes(scheme.accent);
  const regs = meshesNamed(model, /^Airframe registration$/);
  const regOk = regs.length === 2 && regs.every((m) => String(m.material.map && m.material.map.name).includes(scheme.reg));
  const titles = meshesNamed(model, /^Titling$/);
  const titleOk = titles.length === 2 && titles.every((m) => String(m.material.map && m.material.map.name).includes(scheme.title) && m.material.polygonOffset);
  // Readable from both sides: the two decals run their u the opposite way.
  const uDir = (m) => {
    const uv = m.geometry.attributes.uv;
    const pos = m.geometry.attributes.position;
    let a = null;
    let b = null;
    for (let i = 0; i < pos.count; i++) {
      if (a === null || pos.getZ(i) < pos.getZ(a)) a = i;
      if (b === null || pos.getZ(i) > pos.getZ(b)) b = i;
    }
    return Math.sign(uv.getX(b) - uv.getX(a));
  };
  const mirrored = titles.length === 2 && uDir(titles[0]) !== 0 && uDir(titles[0]) === -uDir(titles[1]);
  // On the main tube above the window row, forward of the wing.
  const span = titles.length ? (() => {
    const box = new THREE.Box3();
    for (const m of titles) box.expandByObject(m);
    return box;
  })() : null;
  // Above the window row (top 0.74) and under the hump's flank, from behind
  // door 1 (-21.8) to over the wing root, a line a dozen metres or longer.
  const placed = !!span && span.min.y > 0.74 && span.max.y < 2.4 && span.min.z > -21.8 && span.max.z <= 0 && span.max.z - span.min.z > 12;
  ok('b747 as Air Force One: white over its blue band and line, the dark blue fin, SAM 42 — and "UNITED STATES OF AMERICA" along the body, reading left to right from both sides',
    finOk && skinOk && regOk && titleOk && mirrored && placed,
    `fin ${finOk}, skin ${skinOk}, reg ${regOk} (${regs.length}), title ${titleOk} (${titles.length}), mirrored ${mirrored}, placed ${placed}${span ? ` y ${r2(span.min.y)}..${r2(span.max.y)} z ${r2(span.min.z)}..${r2(span.max.z)}` : ''}`);
  // And the house scheme paints no words: the title is the scheme's, not the type's.
  const plain = ADAPTER.createAircraftModel({ type });
  ok('b747 in house colours: no titling line', meshesNamed(plain, /^Titling$/).length === 0);
  plain.userData.dispose();
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

// Reduce flashing and a crash: the stretched follow view holds still and stands back (src/features/airliners.js stretchView; measured in tests/features/crash-sweep.browser.js).
ok('seizure safety: with Reduce flashing the stretched follow view stands back from a wreck (at least 1.4x), eased in over under a second', FEATURE.CRASH_BACK_REDUCED >= 1.4 && FEATURE.CRASH_BACK_REDUCED <= 2.5 && FEATURE.CRASH_BACK_EASE > 0.2 && FEATURE.CRASH_BACK_EASE <= 1,
  `${FEATURE.CRASH_BACK_REDUCED}x over ${FEATURE.CRASH_BACK_EASE} s`);

console.log('\n' + report.join('\n'));
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

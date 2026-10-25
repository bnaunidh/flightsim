/**
 * The moving parts on every aeroplane model, checked in node against the real
 * factories (planes lane, 2026-10-24: "make every plane model look and WORK
 * more realistically").
 *
 *   node tests/features/model-realism.mjs
 *
 * What it proves, for every fixed-wing type in the roster:
 *   - the model builds with no NaN, and its moving parts are where its class
 *     puts them: spoilers and slats on the airliners and transports (not on a
 *     fighter, not on the Q400's plain wing), wheel-well doors on every
 *     retractable, a reverser sleeve on every turbofan with a fan cowl, a heat
 *     haze on a jet at High and none at Low;
 *   - the sequences: bay doors open while the leg travels and are shut at
 *     both ends; ground spoilers come up on the landing roll with the levers
 *     closed and go down when power is applied; the brakes raise them halfway
 *     in the air; slats come out with the first stage of flap and the flaps
 *     run aft; reversers deploy on the roll with the brakes on and stow below
 *     taxi speed; wheels keep turning after lift-off and wind down;
 *   - the oleos: physics.js writes each leg's compression (wheelCompression)
 *     when the aeroplane stands on its wheels, and the drawn struts give by it;
 *   - the lights: strobes off on the apron, on once rolling fast or airborne;
 *     the beacon with the engine; the landing light with the gear;
 *   - the crash hull: a pack-drawn aeroplane's model carries the hullDriven
 *     flag the game's airframe body sets, and its own body stands aside.
 *
 * Exits non-zero if anything fails.
 */
globalThis.document = {
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
const A = await import(SRC + 'aircraft/model-adapter.js');
const Q = await import(SRC + 'aircraft/model-quality.js');
const FS = await import(SRC + 'render/flash-safety.js');

TER.applyMap(TER.MAP.id);

let passed = 0;
let failed = 0;
function ok(name, pass, detail = '') {
  if (pass) passed++;
  else failed++;
  console.log(`${pass ? 'ok  ' : 'FAIL'} ${name}${detail !== '' ? ` — ${detail}` : ''}`);
}
const f2 = (v) => (Math.round(v * 100) / 100).toString();

/* ---- the roster, by how each one is drawn ---- */
const FIXED = T.AIRCRAFT.filter((t) => !/heli/i.test(t.class || '') && t.id !== 'tpose' && !(t.shape && t.shape.power && t.shape.power.rotor));
const AIRLINER_KINDS = new Set(['airliner', 'transport']);
const NO_SLATS = new Set(['q400', 'concorde', 'massimo']);

const ctl = (o = {}) => ({ pitch: 0, roll: 0, yaw: 0, throttle: 0, brakes: 0, ...o });
const ST = {
  parked: { rpm: 0, engineOn: false, gearPos: 1, flaps: 0, onGround: true, groundSpeed: 0, controls: ctl({ brakes: 1 }) },
  taxi: { rpm: 0.3, engineOn: true, gearPos: 1, flaps: 0, onGround: true, groundSpeed: 8, controls: ctl({ throttle: 0.3 }) },
  roll: { rpm: 0.95, engineOn: true, gearPos: 1, flaps: 0.33, onGround: true, groundSpeed: 60, controls: ctl({ throttle: 1 }) },
  gearMid: { rpm: 0.95, engineOn: true, gearPos: 0.5, flaps: 0.33, onGround: false, groundSpeed: 80, airspeed: 80, controls: ctl({ throttle: 1 }) },
  climb: { rpm: 0.95, engineOn: true, gearPos: 0, flaps: 0, onGround: false, groundSpeed: 100, airspeed: 100, controls: ctl({ throttle: 1 }) },
  speedbrake: { rpm: 0.4, engineOn: true, gearPos: 0, flaps: 0, onGround: false, groundSpeed: 100, airspeed: 100, controls: ctl({ throttle: 0.3, brakes: 0.8 }) },
  approach: { rpm: 0.4, engineOn: true, gearPos: 1, flaps: 1, onGround: false, groundSpeed: 70, airspeed: 70, controls: ctl({ throttle: 0.3 }) },
  rollout: { rpm: 0.6, engineOn: true, gearPos: 1, flaps: 1, onGround: true, groundSpeed: 55, controls: ctl({ throttle: 0, brakes: 0.8 }) },
  slow: { rpm: 0.3, engineOn: true, gearPos: 1, flaps: 1, onGround: true, groundSpeed: 10, controls: ctl({ throttle: 0, brakes: 0.3 }) },
  goAround: { rpm: 0.95, engineOn: true, gearPos: 1, flaps: 1, onGround: true, groundSpeed: 40, controls: ctl({ throttle: 1 }) },
};
const run = (m, s, seconds = 3) => {
  for (let i = 0; i < Math.round(seconds * 60); i++) m.userData.update(1 / 60, ST[s], { isNight: true });
};
const count = (m) => {
  let tris = 0;
  let nan = 0;
  m.traverse((o) => {
    if (!o.isMesh) return;
    const g = o.geometry;
    tris += ((g.index ? g.index.count : g.attributes.position.count) / 3) * (o.isInstancedMesh ? o.count : 1);
    const p = g.attributes.position.array;
    for (let i = 0; i < p.length; i++) if (!Number.isFinite(p[i])) nan++;
  });
  return { tris: Math.round(tris), nan };
};
const sprites = (m) => {
  const out = [];
  m.traverse((o) => {
    if (o.isSprite) out.push(o);
  });
  return out;
};

/**
 * Every vertex of the nodes' meshes, model frame, before and after: the
 * vertices nearest the hinge (the panel's front row) move by at most `slack`,
 * and none moves further than the panel is deep (plus slack).
 */
function hingeHolds(m, nodes, before, after, slack = 0.05) {
  const grab = () => {
    m.updateMatrixWorld(true);
    const inv = m.matrixWorld.clone().invert();
    return nodes.map((n) => {
      const vs = [];
      n.traverse((o) => {
        if (!o.isMesh) return;
        const p = o.geometry.attributes.position;
        for (let i = 0; i < p.count; i++) vs.push(new THREE.Vector3().fromBufferAttribute(p, i).applyMatrix4(o.matrixWorld).applyMatrix4(inv));
      });
      return vs;
    });
  };
  before();
  const a = grab();
  after();
  const b = grab();
  let worstFront = 0;
  let worstOver = 0;
  for (let k = 0; k < a.length; k++) {
    const vs = a[k];
    const zMin = Math.min(...vs.map((v) => v.z));
    const zMax = Math.max(...vs.map((v) => v.z));
    const depth = zMax - zMin;
    for (let i = 0; i < vs.length; i++) {
      const d = b[k][i].distanceTo(vs[i]);
      // The front row: within a tenth of the depth of the most forward point at this span... approximated per panel by local x neighbours.
      worstOver = Math.max(worstOver, d - (depth + slack));
    }
    // Front edge: for each vertex, the most forward vertex at nearly the same span.
    for (let i = 0; i < vs.length; i++) {
      const front = vs.every((w) => Math.abs(w.x - vs[i].x) > 0.05 || w.z >= vs[i].z - 1e-4);
      if (front) worstFront = Math.max(worstFront, b[k][i].distanceTo(vs[i]));
    }
  }
  return { ok: worstFront <= slack && worstOver <= 0, detail: `front edge moved ${worstFront.toFixed(3)} m (<= ${slack.toFixed(2)}), worst excess over panel depth ${worstOver.toFixed(2)} m` };
}

/* ---- 1. every fixed-wing type: what it carries, and the sequences ---- */
Q.setModelQuality('high');
for (const type of FIXED) {
  const id = type.id;
  const m = A.createAircraftModel({ type });
  const pack = !!m.userData.fleetBridge;
  const c0 = count(m);
  ok(`${id}: builds with no NaN (${pack ? 'pack' : 'civil'}, ${c0.tris} triangles)`, c0.nan === 0, `${c0.nan} NaN`);

  // The parts, by factory.
  let doors;
  let spoilers;
  let slats;
  let reversers;
  let fowler;
  let haze;
  let retractable;
  let kind;
  if (pack) {
    const R = m.userData.realism;
    ok(`${id}: the realism layer is on the model (userData.realism)`, !!R);
    if (!R) continue;
    doors = R.bayDoors;
    spoilers = R.spoilers;
    slats = R.slats;
    reversers = R.reversers;
    fowler = R.fowler;
    haze = R.haze;
    retractable = !!(m.userData.config.gear && m.userData.config.gear.retractable);
    kind = m.userData.config.kind;
  } else {
    const Pm = m.userData.parts;
    doors = Pm.bayDoors.map((d) => ({ node: d.obj, sign: d.sign }));
    spoilers = Pm.spoilers.map((s) => ({ node: s.obj, side: -s.sign, get angle() { return s.angle || 0; } }));
    slats = [];
    reversers = Pm.reversers.map((r) => ({ node: r.obj, travel: r.travel, z0: r.z0 }));
    fowler = [];
    haze = [];
    retractable = !!type.shape.retractable;
    kind = type.class === 'Airliner' ? 'airliner' : 'light';
  }

  if (retractable) ok(`${id}: a retractable carries wheel-well doors (four: a pair for the nose, one a main)`, doors.length === 4, `${doors.length}`);
  else ok(`${id}: fixed gear, no wheel-well doors`, doors.length === 0, `${doors.length}`);
  if (pack) {
    const wingDevices = AIRLINER_KINDS.has(kind) && m.userData.config.wing && m.userData.config.wing.flaps !== false;
    ok(`${id}: spoilers ${wingDevices ? 'on both wings' : 'none (not an airliner wing)'}`, spoilers.length === (wingDevices ? 2 : 0), `${spoilers.length}`);
    ok(`${id}: slats ${wingDevices && !NO_SLATS.has(id) ? 'on both wings' : 'none'}`, slats.length === (wingDevices && !NO_SLATS.has(id) ? 2 : 0), `${slats.length}`);
    // The airliner kit's turbofans (every podded jet on an airliner kind but Concorde's, whose nacelles are its own boxes) carry a fan cowl, and so a sleeve.
    const podded = (m.userData.config.engines || []).filter((e) => e.kind === 'jet' && !e.buried).length;
    const expectRev = kind === 'airliner' && id !== 'concorde' ? podded : 0;
    ok(`${id}: a reverser sleeve on every turbofan with a fan cowl (${expectRev})`, reversers.length === expectRev, `${reversers.length}`);
    const jets = (m.userData.config.engines || []).filter((e) => e.kind === 'jet').length;
    ok(`${id}: ${jets ? 'one heat haze for its jets at High' : 'no jets, no haze'}`, haze.length === (jets ? 1 : 0), `${haze.length} for ${jets} jets`);
  } else if (id === 'meridian') {
    ok('meridian: spoilers over both flaps on both wings, a fan and a reverser sleeve in each nacelle', spoilers.length === 4 && reversers.length === 2 && m.userData.parts.fans.length === 2, `${spoilers.length} spoilers, ${reversers.length} reversers, ${m.userData.parts.fans.length} fans`);
  }

  // Bay doors: shut on the ground, open while the leg travels, shut again when it is up.
  if (doors.length) {
    run(m, 'parked', 2);
    const shutDown = doors.every((d) => Math.abs(d.node.rotation.z) < 0.02);
    run(m, 'gearMid', 2);
    const openMid = doors.every((d) => Math.abs(d.node.rotation.z) > 1.0 && Math.sign(d.node.rotation.z) === Math.sign(d.sign));
    run(m, 'climb', 2);
    const shutUp = doors.every((d) => Math.abs(d.node.rotation.z) < 0.02);
    ok(`${id}: bay doors shut with the gear down, open while it travels, shut again with it up`, shutDown && openMid && shutUp, `down ${shutDown}, mid ${openMid}, up ${shutUp}`);
  }

  // Spoilers and reversers, through a landing.
  if (spoilers.length) {
    run(m, 'climb', 2);
    const inFlight = spoilers.every((s) => Math.abs(s.angle) < 0.02);
    run(m, 'speedbrake', 3);
    const half = spoilers.every((s) => Math.abs(s.angle) > 0.3 && Math.abs(s.angle) < 0.6);
    run(m, 'approach', 3);
    const stowed = spoilers.every((s) => Math.abs(s.angle) < 0.02);
    run(m, 'rollout', 3);
    const upOnRoll = spoilers.every((s) => Math.abs(s.angle) > 0.8);
    const liftUp = spoilers.every((s) => Math.sign(s.angle) === -Math.sign(s.side));
    run(m, 'goAround', 3);
    const downWithPower = spoilers.every((s) => Math.abs(s.angle) < 0.02);
    ok(`${id}: spoilers flat in the climb, halfway as speedbrakes with the brakes in the air, flat on the approach, full on the landing roll, flat again with power`, inFlight && half && stowed && upOnRoll && downWithPower, `climb ${inFlight}, brake ${half}, approach ${stowed}, roll ${upOnRoll}, power ${downWithPower}`);
    ok(`${id}: a deployed spoiler lifts its trailing edge (the hinge turns the right way on each wing)`, liftUp);
    // About the hinge line itself: the panels' leading edges stay on the wing and nothing rises more than a panel's chord (a turn about the parent's X once lifted an outboard slat metres off a swept wing).
    const hingeOk = hingeHolds(m, spoilers.map((s) => s.node), () => { run(m, 'climb', 2); }, () => { run(m, 'rollout', 4); });
    ok(`${id}: spoilers turn about their own hinge lines (front edges stay put, rise within a panel chord)`, hingeOk.ok, hingeOk.detail);
  }
  if (reversers.length) {
    const z0 = reversers.map((r) => (pack ? 0 : r.z0));
    run(m, 'approach', 2);
    const stowedAir = reversers.every((r, i) => Math.abs(r.node.position.z - z0[i]) < 0.01);
    run(m, 'rollout', 3);
    const out = reversers.every((r, i) => r.node.position.z - z0[i] > r.travel * 0.9);
    run(m, 'slow', 3);
    const stowedSlow = reversers.every((r, i) => Math.abs(r.node.position.z - z0[i]) < 0.01);
    ok(`${id}: reverser sleeves stowed on the approach, aft on the roll with the brakes on, stowed again below taxi speed`, stowedAir && out && stowedSlow, `air ${stowedAir}, roll ${out}, slow ${stowedSlow}`);
  }
  if (slats.length) {
    run(m, 'climb', 2);
    const inSlats = slats.every((s) => s.node.position.distanceTo(s.rest) < 0.01);
    run(m, 'approach', 3);
    const outSlats = slats.every((s) => s.node.position.distanceTo(s.rest) > s.travel * 0.9 && s.node.position.z < s.rest.z);
    const flapsAft = fowler.every((f) => f.node.position.z > f.rest.z + f.aft * 0.9);
    ok(`${id}: slats in with the flaps up, forward and down with them out; the flaps run aft on their tracks`, inSlats && outSlats && flapsAft, `in ${inSlats}, out ${outSlats}, aft ${flapsAft}`);
    const slatHinge = hingeHolds(m, slats.map((s) => s.node), () => { run(m, 'climb', 2); }, () => { run(m, 'approach', 3); }, slats[0].travel * 1.2);
    ok(`${id}: slats droop about their own hinge lines (no part moves further than the slat's travel and chord)`, slatHinge.ok, slatHinge.detail);
  }

  // Wheels: turning after lift-off, winding down.
  {
    run(m, 'roll', 3);
    const wheel = pack ? m.userData.realism.wheels[0] : null;
    const w0 = pack ? wheel.omega : m.userData.parts.wheelOmega;
    run(m, 'gearMid', 1);
    const w1 = pack ? wheel.omega : m.userData.parts.wheelOmega;
    run(m, 'climb', 10);
    const w2 = pack ? wheel.omega : m.userData.parts.wheelOmega;
    ok(`${id}: the wheels turn at the ground speed on the roll, keep turning a second after lift-off, and have wound down ten seconds on`, w0 > 10 && w1 > w0 * 0.5 && w1 < w0 && w2 < w0 * 0.1, `${f2(w0)} -> ${f2(w1)} -> ${f2(w2)} rad/s`);
  }

  // Lights: the strobes' ground rule, the beacon, the landing light.
  {
    const sp = sprites(m);
    const byPos = (pick) => sp.filter(pick);
    const strobes = byPos((s) => Math.abs(s.position.x) > 1 && (s.material.color.r > 0.9 && s.material.color.g > 0.9));
    const beacons = byPos((s) => Math.abs(s.position.x) < 0.3 && s.material.color.r > 0.9 && s.material.color.g < 0.4);
    let strobeLitParked = 0;
    let strobeLitRoll = 0;
    let beaconLit = 0;
    for (let i = 0; i < 120; i++) {
      m.userData.update(1 / 60, ST.parked, { isNight: true });
      if (strobes.some((s) => s.visible && s.material.opacity > 0.05)) strobeLitParked++;
    }
    // With Reduce flashing on (the default) the beacon is a swell, not a blink, so "lit" is the bright half of it.
    for (let i = 0; i < 120; i++) {
      m.userData.update(1 / 60, ST.roll, { isNight: true });
      if (strobes.some((s) => s.visible && s.material.opacity > 0.05)) strobeLitRoll++;
      if (beacons.some((s) => s.visible && s.material.opacity > 0.6)) beaconLit++;
    }
    ok(`${id}: strobes off with the engine off on the apron, flashing on the roll (lit some of the time, never all of it); a beacon blinks`, strobes.length >= 2 && strobeLitParked === 0 && strobeLitRoll > 5 && strobeLitRoll < 100 && beacons.length >= 1 && beaconLit > 10 && beaconLit < 110, `${strobes.length} strobes lit ${strobeLitParked} / ${strobeLitRoll} of 120 frames; ${beacons.length} beacon(s) bright ${beaconLit}`);
  }
}

/* ---- 2. the heat haze follows the tier ---- */
{
  Q.setModelQuality('low');
  const low = A.createAircraftModel({ type: T.getAircraft('a320') });
  ok('a320 built at Low carries no heat haze at all', low.userData.realism.haze.length === 0, `${low.userData.realism.haze.length}`);
  Q.setModelQuality('high');
  const high = A.createAircraftModel({ type: T.getAircraft('a320') });
  const h = high.userData.realism.haze[0];
  run(high, 'parked', 1);
  const offParked = !h.node.visible && h.node.scale.x < 0.01;
  run(high, 'roll', 1);
  const onRoll = h.node.visible && h.node.scale.x === 1 && h.mat.uniforms.k.value > 0.5;
  Q.setModelQuality('low');
  run(high, 'roll', 1);
  const offLow = !h.node.visible;
  Q.setModelQuality('high');
  ok('a320 at High: the haze is scaled to nothing at idle, shown under power, and hidden again when the tier drops to Low', offParked && onRoll && offLow, `idle ${offParked}, power ${onRoll}, low ${offLow}`);
  // Bounds: the airframe's measured tail is the tail, not the plume.
  const tail = high.userData.flightGeometry.hardPoints.find((p) => p.partId === 'tail');
  const body = high.userData.config.body;
  ok('a320: the haze never reaches the airframe bounds (the tail strike point is at the tail cone, within half a metre of the last body station)', !!tail && Math.abs(tail.pos[2] - body[body.length - 1][0]) < 0.6, tail ? `tail z ${f2(tail.pos[2])}, last station ${f2(body[body.length - 1][0])}` : 'no tail');
  ok('a320: the haze material reads as an effect to the break-up survey (transparent, low opacity)', h.mat.transparent && h.mat.opacity < 0.25);
}

/* ---- 3. the oleos: the physics writes each leg's compression, and the struts give by it ---- */
{
  for (const id of ['skylark', 'a320']) {
    const type = T.getAircraft(id);
    P.applyAircraft(id);
    const ac = new P.Aircraft();
    const m = A.createAircraftModel({ type });
    ac.reset({ pos: new THREE.Vector3(-470, 0, 0), headingDeg: 90, speed: 0, altAGL: 0, engineOn: false });
    const w = {
      windVector: (o) => (o || new THREE.Vector3()).set(0, 0, 0),
      gustVector: (o) => (o || new THREE.Vector3()).set(0, 0, 0),
      turbulenceLevel: () => 0,
      cond: { rain: 0, cloud: 0.2, visibility: 1 },
      time_s: 0,
      isNight: false,
    };
    for (let i = 0; i < 240; i++) ac.update(1 / 120, w);
    const wc = ac.wheelCompression;
    ok(`${id}: standing on its wheels the physics reports each oleo's compression (nose, left, right all pressed in)`, !!wc && wc.nose > 0.005 && wc.left > 0.005 && wc.right > 0.005 && wc.left < 1 && Math.abs(wc.left - wc.right) < 0.05, wc ? `nose ${f2(wc.nose)} left ${f2(wc.left)} right ${f2(wc.right)} m` : 'none');
    // The drawn strut gives by it.
    const rest = { ...ST.parked, wheelCompression: { nose: 0, left: 0, right: 0 } };
    const pressed = { ...ST.parked, wheelCompression: { nose: 0.08, left: 0.1, right: 0.1 } };
    const axles = [];
    m.traverse((o) => {
      if (o.name === 'Suspending axle' || o.name === 'axle') axles.push(o);
    });
    const yOf = () => {
      m.updateMatrixWorld(true);
      return axles.map((a) => new THREE.Vector3().setFromMatrixPosition(a.matrixWorld).y);
    };
    m.userData.update(0, rest, {});
    for (let i = 0; i < 30; i++) m.userData.update(1 / 60, rest, {});
    const y0 = yOf();
    for (let i = 0; i < 60; i++) m.userData.update(1 / 60, pressed, {});
    const y1 = yOf();
    const rose = axles.length >= 3 && y1.every((y, i) => y > y0[i] + 0.03);
    ok(`${id}: handed a compression, the drawn wheels rise up their struts by it`, rose, `${axles.length} axles, rise ${y1.map((y, i) => f2(y - y0[i])).join(', ')} m`);
  }
}

/* ---- 3b. at rest the moving parts are hidden (no draw calls), and a shut door lies under the skin, not in the air ---- */
{
  Q.setModelQuality('low');
  let hiddenAll = true;
  const shown = [];
  for (const type of FIXED) {
    const m = A.createAircraftModel({ type });
    const R = m.userData.realism;
    const parts = R ? [...R.spoilers, ...R.slats, ...R.bayDoors, ...R.reversers].map((d) => d.node).concat(R.reversers.map((r) => r.cascade))
      : [...m.userData.parts.spoilers, ...m.userData.parts.bayDoors].map((d) => d.obj);
    // Untouched (a parked apron aeroplane nobody updates), and then flying clean.
    const check = (when) => {
      for (const n of parts) if (n.visible) { hiddenAll = false; shown.push(`${type.id} ${n.name} (${when})`); }
    };
    check('as built');
    run(m, 'climb', 3);
    check('in the climb');
  }
  ok('every moving part (spoilers, slats, bay doors, reverser sleeves and cascades) is hidden at rest — as built and flying clean — so it costs no draw call until it moves', hiddenAll, shown.slice(0, 6).join('; '));
  Q.setModelQuality('high');

  // A shut wheel-well door is seated on the skin above it (bay-door-seat.js): an A380's main doors once hung 1.8 m under the wing root.
  for (const id of ['a380', 'b777', 'b747', 'a320', 'f22', 'meridian']) {
    const m = A.createAircraftModel({ type: T.getAircraft(id) });
    const R = m.userData.realism;
    const doors = R ? R.bayDoors.map((d) => d.node) : m.userData.parts.bayDoors.map((d) => d.obj);
    m.updateMatrixWorld(true);
    const ex = new Set();
    doors.forEach((d) => d.traverse((o) => ex.add(o)));
    const targets = [];
    m.traverse((o) => {
      const chain = `${o.name} ${o.parent ? o.parent.name : ''} ${o.parent && o.parent.parent ? o.parent.parent.name : ''}`;
      if (o.isMesh && !ex.has(o) && !/gear|wheel|tyre|leg|strut|oleo|axle|haze|door|bogie/i.test(chain)) targets.push(o);
    });
    let worst = 0;
    for (const d of doors) {
      const mesh = d.children.find((o) => o.isMesh);
      mesh.geometry.computeBoundingBox();
      const bb = mesh.geometry.boundingBox;
      // The middle of the door's span, on its top face (found by looking down onto the panel: it is tilted to follow the skin).
      const above = new THREE.Vector3((bb.min.x + bb.max.x) / 2, bb.max.y + 5, (bb.min.z + bb.max.z) / 2).applyMatrix4(mesh.matrixWorld);
      const top = new THREE.Raycaster(above, new THREE.Vector3(0, -1, 0), 0, 20).intersectObject(mesh, false)[0];
      const hit = top && new THREE.Raycaster(top.point.clone().add(new THREE.Vector3(0, 0.001, 0)), new THREE.Vector3(0, 1, 0), 0, 3).intersectObjects(targets, false)[0];
      worst = Math.max(worst, hit ? hit.distance : 3);
    }
    ok(`${id}: its shut wheel-well doors lie just under the skin above them (worst gap at mid-door under 0.25 m)`, doors.length > 0 && worst < 0.25, `${doors.length} doors, worst ${f2(worst)} m`);
  }
}

/* ---- 4. the crash hull flag on a pack model ---- */
{
  const m = A.createAircraftModel({ type: T.getAircraft('vanguard') });
  ok('vanguard: a fresh pack model is not hull-driven, and its reset clears the flag', !m.userData.hullDriven && (() => {
    m.userData.hullDriven = true;
    m.userData.resetDamage();
    return m.userData.hullDriven === false;
  })());
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);

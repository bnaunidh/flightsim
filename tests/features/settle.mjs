/**
 * Standing on the wheels: Aircraft.settleOnGear(), checked headless against
 * the real roster and the real flight model.
 *
 *   node tests/features/settle.mjs
 *
 * What it proves:
 *   - for every aeroplane in the roster, in both flight modes, the settle
 *     converges in a handful of Newton steps to a pose the flight model
 *     then holds: with the engine off, 3 s hands off on the runway moves it
 *     less than 2 cm and 0.2°;
 *   - with the engine at idle (how the game spawns you) it still moves less
 *     than 2 cm, ends where it started, and the pitch transient is only the
 *     tyres taking up the idle thrust (bounded below; see the note there);
 *   - calling it twice gives the same pose and keeps the heading;
 *   - it is not tuned to the roster: a tail-dragger, a helicopter on four
 *     skid points, gear a thousand times stiffer, gear overloaded onto its
 *     stops and a long-nosed jet all converge, and the ones the 120 Hz
 *     integrator can fly stay put.
 *
 * Every spawn is the game's: RUNWAY_START on the loaded map, calm air, two
 * 120 Hz steps per 60 Hz frame. Exits non-zero if anything fails.
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
const { RUNWAY_START } = await import(SRC + 'game/missions.js');

// Terrain off the runway plateau is NaN until a map has been applied.
TER.applyMap(TER.MAP.id);
const G = 9.80665;

let failed = 0;
let passed = 0;
function ok(name, pass, detail = '') {
  if (pass) passed++;
  else failed++;
  console.log(`${pass ? 'ok  ' : 'FAIL'} ${name}${detail !== '' ? ` — ${detail}` : ''}`);
}

const weather = {
  windVector: (o) => (o || new THREE.Vector3()).set(0, 0, 0),
  gustVector: (o) => (o || new THREE.Vector3()).set(0, 0, 0),
  turbulenceLevel: () => 0,
  cond: { rain: 0, cloud: 0 },
  time_s: 0,
  downdraft: 0,
  vortex: null,
};
const NEUTRAL = { throttle: 0, pitch: 0, roll: 0, yaw: 0, brakes: 0 };

/** Spawn `id` on the runway and fly it hands off; largest change from the spawn pose. */
function spawnAndHold(id, { mode = 'simplified', engineOn = true, seconds = 3, before } = {}) {
  P.applyAircraft(id);
  const ac = new P.Aircraft();
  ac.mode = mode;
  if (before) before(ac);
  ac.reset({ ...RUNWAY_START, engineOn });
  const settle = ac.settleOnGear(); // a second call: must not move it
  const y0 = ac.pos.y;
  const p0 = ac.pitchAngleDeg();
  let dy = 0;
  let dp = 0;
  for (let f = 0, n = Math.round(seconds * 60); f < n; f++) {
    Object.assign(ac.controls, NEUTRAL);
    ac.update(1 / 120, weather);
    ac.update(1 / 120, weather);
    if (ac.crashed) break;
    dy = Math.max(dy, Math.abs(ac.pos.y - y0));
    dp = Math.max(dp, Math.abs(ac.pitchAngleDeg() - p0));
  }
  return { ac, settle, y0, p0, dyCm: dy * 100, dp, endDp: ac.pitchAngleDeg() - p0 };
}

/* ------------------------------------------------------------------ *
 * The roster
 * ------------------------------------------------------------------ */
const IDS = T.AIRCRAFT.map((a) => a.id);
ok('roster: at least the fifteen aeroplanes this was measured on', IDS.length >= 15, IDS.join(' '));

for (const mode of ['simplified', 'realistic']) {
  for (const id of IDS) {
    const off = spawnAndHold(id, { mode, engineOn: false });
    const s = off.settle;
    const W = (P.SPEC.mass + off.ac.extraMass) * G;
    ok(`${id} ${mode}: settle converges in at most six pitch steps`,
      !!s && s.iterations <= 6 && s.residualN < 1e-6 * W,
      s ? `${s.iterations} steps, ${s.residualN.toExponential(1)} N, ${s.residualNm.toExponential(1)} N·m` : 'returned nothing');
    ok(`${id} ${mode}: engine off, it stays exactly where it was put (3 s)`,
      !off.ac.crashed && off.ac.onGround && off.dyCm < 2 && off.dp < 0.2,
      `${off.ac.crashed ? off.ac.crashReason + ', ' : ''}${off.dyCm.toFixed(2)} cm, ${off.dp.toFixed(3)}° at ${off.p0.toFixed(2)}°`);

    /*
     * Engine at idle, as the game spawns you. The parking brake in update()
     * is a viscous tyre force (3000 N·s/m a wheel below its grip limit), so
     * it holds nothing at zero speed: the idle thrust rolls the aeroplane
     * forward until that force has built up to match it, over m / 9000 s
     * (0.12 s for the Skylark, 0.8 s for the Vanguard, 3 s for the A380),
     * and it creeps on at T / 9000 m/s — the Vanguard at 1.7 m/s. The settle
     * places it where it rests once the tyres carry the thrust, which is
     * where it ends up; the pitch between is that build-up, measured at up to
     * 0.93° (Vanguard) and zero with a brake that holds (tried in a copy of
     * the tyre code). On the rotor the hover assist's cyclic, which the
     * settle does not model, levels it by 0.46°.
     */
    const on = spawnAndHold(id, { mode, engineOn: true });
    ok(`${id} ${mode}: engine at idle, height holds within 2 cm (3 s)`,
      !on.ac.crashed && on.ac.onGround && on.dyCm < 2,
      `${on.ac.crashed ? on.ac.crashReason + ', ' : ''}${on.dyCm.toFixed(2)} cm`);
    const rotor = !!P.SPEC.rotor;
    ok(`${id} ${mode}: engine at idle, ends at the attitude it spawned in`,
      Math.abs(on.endDp) < (rotor ? 0.6 : 0.2), `${on.endDp.toFixed(3)}° after 3 s`);
    ok(`${id} ${mode}: engine at idle, only the tyre take-up rocks it (< 1.2°)`,
      on.dp < 1.2, `${on.dp.toFixed(3)}° at most`);
  }
}

/* ------------------------------------------------------------------ *
 * Calling it again
 * ------------------------------------------------------------------ */
{
  P.applyAircraft('meridian');
  const ac = new P.Aircraft();
  ac.reset({ ...RUNWAY_START, headingDeg: 37, engineOn: true });
  const y1 = ac.pos.y;
  const q1 = ac.quat.clone();
  ac.settleOnGear();
  ac.settleOnGear();
  // Not bit-identical: the air density (so the idle thrust) is read at the
  // height it starts from.
  ok('twice is the same as once', Math.abs(ac.pos.y - y1) < 1e-6 && ac.quat.angleTo(q1) < 1e-6,
    `${(ac.pos.y - y1).toExponential(1)} m, ${ac.quat.angleTo(q1).toExponential(1)} rad`);
  const f = ac.forward();
  const hdg = (THREE.MathUtils.radToDeg(Math.atan2(f.x, -f.z)) + 360) % 360;
  ok('the heading is kept', Math.abs(hdg - 37) < 1e-6, `${hdg.toFixed(6)}°`);
}

/* ------------------------------------------------------------------ *
 * Not tuned to the roster
 * ------------------------------------------------------------------ */
function leg(name, x, y, z, k, travel, extra = {}) {
  return { name, pos: new THREE.Vector3(x, y, z), steer: false, brake: true, k, c: k * 0.15, travel, stopRate: 55, ...extra };
}
/** Replace the gear of the current type (and clear the strike points), spawn, report. */
function synthetic(name, id, gear, { mode = 'realistic', extraMass = 0, fly = true } = {}) {
  const run = spawnAndHold(id, {
    mode,
    engineOn: false,
    seconds: fly ? 3 : 0,
    before: (ac) => {
      P.SPEC.gearPoints = gear(P.SPEC);
      P.SPEC.hardPoints = [];
      ac.extraMass = extraMass;
    },
  });
  const s = run.settle;
  const W = (P.SPEC.mass + extraMass) * G;
  const ground = TER.heightAt(run.ac.pos.x, run.ac.pos.z);
  const w = new THREE.Vector3();
  let down = 0;
  let onStop = 0;
  for (const g of P.SPEC.gearPoints) {
    const pen = ground - w.copy(g.pos).applyQuaternion(run.ac.quat).add(run.ac.pos).y;
    if (pen > 0) down++;
    if (pen > g.travel) onStop++;
  }
  return { run, s, W, down, onStop };
}

{
  // A tail-dragger: mains ahead of the CG, a tail wheel far behind it.
  const r = synthetic('tail-dragger', 'skylark', (S) => {
    const k = 34000 * (S.mass / 1100);
    return [leg('left', -1.4, -1.5, -0.45, k, 0.26), leg('right', 1.4, -1.5, -0.45, k, 0.26), leg('tail', 0, -0.35, 4.2, k * 0.25, 0.12)];
  });
  ok('tail-dragger: converges, three wheels down, sitting tail-down',
    !!r.s && r.s.residualN < 1e-6 * r.W && r.down === 3 && r.run.p0 > 10,
    r.s ? `${r.s.iterations} steps, ${r.down} down, pitch ${r.run.p0.toFixed(2)}°` : 'returned nothing');
  ok('tail-dragger: stays put (3 s)', !r.run.ac.crashed && r.run.dyCm < 2 && r.run.dp < 0.2,
    `${r.run.dyCm.toFixed(2)} cm, ${r.run.dp.toFixed(3)}°`);
  const rs = synthetic('tail-dragger simplified', 'skylark', (S) => {
    const k = 34000 * (S.mass / 1100);
    return [leg('left', -1.4, -1.5, -0.45, k, 0.26), leg('right', 1.4, -1.5, -0.45, k, 0.26), leg('tail', 0, -0.35, 4.2, k * 0.25, 0.12)];
  }, { mode: 'simplified' });
  ok('tail-dragger in simplified mode (the ground hold pushes its nose down): stays put (3 s)',
    !!rs.s && rs.s.residualN < 1e-6 * rs.W && !rs.run.ac.crashed && rs.run.dyCm < 2 && rs.run.dp < 0.2,
    `${rs.s ? rs.s.iterations : '-'} steps, ${rs.run.dyCm.toFixed(2)} cm, ${rs.run.dp.toFixed(3)}° at ${rs.run.p0.toFixed(2)}°`);
}
{
  // The helicopter on skids: four contact points, two a side, fore and aft.
  const r = synthetic('skids', 'harrier', (S) => {
    const k = 40000 * (S.mass / 2200);
    return [leg('lf', -1.1, -1.6, -1.2, k, 0.15), leg('rf', 1.1, -1.6, -1.2, k, 0.15), leg('lr', -1.1, -1.6, 1.0, k, 0.15), leg('rr', 1.1, -1.6, 1.0, k, 0.15)];
  });
  ok('skids: converges on all four points', !!r.s && r.s.residualN < 1e-6 * r.W && r.down === 4,
    r.s ? `${r.s.iterations} steps, ${r.down} down, pitch ${r.run.p0.toFixed(2)}°` : 'returned nothing');
  ok('skids: stays put (3 s)', !r.run.ac.crashed && r.run.dyCm < 2 && r.run.dp < 0.2,
    `${r.run.dyCm.toFixed(2)} cm, ${r.run.dp.toFixed(3)}°`);
}
{
  // Gear a thousand times stiffer than the Skylark's. Past what the 120 Hz
  // integrator can fly (sqrt(k/m) x dt > 2), so this checks the solve only.
  const r = synthetic('stiff', 'skylark', (S) => S.gearPoints.map((g) => ({ ...g, pos: g.pos.clone(), k: g.k * 1000 })), { fly: false });
  ok('gear 1000x stiffer: converges, all wheels down', !!r.s && r.s.residualN < 1e-6 * r.W && r.down === 3,
    r.s ? `${r.s.iterations} steps, ${r.s.residualN.toExponential(1)} N` : 'returned nothing');
}
{
  // Twice its own weight in the cabin: every leg through its travel and onto
  // the stop, still under the 160 kN a leg update() allows.
  const r = synthetic('overloaded', 'skylark', (S) => S.gearPoints.map((g) => ({ ...g, pos: g.pos.clone() })), { extraMass: 2000 });
  ok('overloaded onto the stops: converges with the legs on the stops', !!r.s && r.s.residualN < 1e-6 * r.W && r.onStop === 3,
    r.s ? `${r.s.iterations} steps, ${r.onStop} on the stop` : 'returned nothing');
  ok('overloaded: stays put (3 s)', !r.run.ac.crashed && r.run.dyCm < 2 && r.run.dp < 0.2,
    `${r.run.dyCm.toFixed(2)} cm, ${r.run.dp.toFixed(3)}°`);
}
{
  // More than three legs capped at 160 kN can carry: there is no balance.
  // It must say so and leave the aeroplane level on its lowest wheel, not
  // sink it through the runway looking for one.
  const r = synthetic('impossible', 'meridian', (S) => S.gearPoints.map((g) => ({ ...g, pos: g.pos.clone() })), { extraMass: 49500, fly: false });
  const lowest = Math.min(...P.SPEC.gearPoints.map((g) => g.pos.y));
  const ground = TER.heightAt(r.run.ac.pos.x, r.run.ac.pos.z);
  ok('beyond the legs\' 160 kN caps: no answer, left level on its lowest wheel',
    r.s === null && Math.abs(r.run.ac.pos.y - (ground - lowest)) < 1e-9 && Math.abs(r.run.p0) < 1e-9,
    `returned ${JSON.stringify(r.s)}, ${(r.run.ac.pos.y - ground).toFixed(3)} m up, pitch ${r.run.p0.toFixed(3)}°`);
}
{
  // A long-nosed jet: the nose leg 12 m ahead, which is what spawned a first
  // F-22 draft 30 m up and inverted under the old relaxation.
  const r = synthetic('long nose', 'f22', (S) => S.gearPoints.map((g) => ({ ...g, pos: g.name === 'nose' ? new THREE.Vector3(0, g.pos.y, -12) : g.pos.clone() })));
  ok('nose leg 12 m ahead: converges, three wheels down, near level', !!r.s && r.s.residualN < 1e-6 * r.W && r.down === 3 && Math.abs(r.run.p0) < 3,
    r.s ? `${r.s.iterations} steps, pitch ${r.run.p0.toFixed(2)}°` : 'returned nothing');
  ok('nose leg 12 m ahead: stays put (3 s)', !r.run.ac.crashed && r.run.dyCm < 2 && r.run.dp < 0.2,
    `${r.run.dyCm.toFixed(2)} cm, ${r.run.dp.toFixed(3)}°`);
}

console.log(`\nsettle: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

/**
 * T-Pose Harrison's two tricks, flown headless against the real flight model.
 *
 *   node tests/features/tpose.mjs
 *
 * What it proves (src/features/tpose/moves.js):
 *   - with no trick running his step is physics.js's own, untouched — so the
 *     1 km/h over Massimo (tests/features/fighters.mjs) is his ordinary flight;
 *   - THE SPIN CLIMB, from the runway: up off it with nothing touching, head
 *     straight up within two seconds, wings level the whole way (the flight
 *     model's attitude never rolls: the spin is drawn), 500 kt within 16 s,
 *     climbing at 500 kt; the spin pattern on the stick bytes while he spins;
 *     T again: the spin stops and he eases back to level, still flying; a
 *     firm pull stops it, a gentle one does not; near the top of the world he
 *     levels off by himself and never goes through it;
 *   - THE BOOST: 1000 kt (Mach 1.5 low down) along his flight path, held,
 *     without "overspeed" or coming apart, flown with the stick (it banks and
 *     turns him); the throttle to idle and he slows back to his own speeds,
 *     his red line put back; a dive into the sea at 1000 kt is an ordinary
 *     crash; the sonic boom event as he goes through Mach 1;
 *   - the spin and the boost cancel each other;
 *   - P, P, P: three presses inside a second are the boost; a single press
 *     is the autopilot, once, after 0.4 s; two presses toggle nothing.
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
const { Weather } = await import(SRC + 'world/weather.js');
const Terrain = await import(SRC + 'world/terrain.js');
const M = await import(SRC + 'features/tpose/moves.js');
Terrain.applyMap('kestrel');

const KT = 1.94384;
const STEP = 1 / 120;
const W = new Weather();
W.windSpeedKts = 0;
const inner = P.Aircraft.prototype.update;
let failed = 0;
let passed = 0;
function ok(name, pass, detail = '') {
  if (pass) passed++;
  else failed++;
  console.log(`${pass ? 'ok  ' : 'FAIL'}  ${name}${detail !== '' ? '  —  ' + detail : ''}`);
  return !!pass;
}
function make(opts) {
  P.applyAircraft('tpose');
  const ac = new P.Aircraft();
  ac.reset(opts);
  return ac;
}
/** Fly `secs` through the move (or plain physics when it is off). `inp(t)` is what the pilot holds. */
function fly(ac, mv, secs, inp = null, each = null) {
  for (let t = 0; t < secs; t += STEP) {
    const i = inp ? inp(t) : { pitch: 0, roll: 0, throttle: 1 };
    mv.step(ac, STEP, W, inner, i);
    if (each && each(t) === true) return t;
    if (ac.crashed) return t;
  }
  return secs;
}
const kt = (ac) => ac.vel.length() * KT;

/* ------------------------------------------------- ordinary flight --- */
{
  const a = make({ pos: new THREE.Vector3(0, 0, 0), headingDeg: 90, engineOn: true, gearDown: false, speed: 200, altAGL: 1500 });
  const b = make({ pos: new THREE.Vector3(0, 0, 0), headingDeg: 90, engineOn: true, gearDown: false, speed: 200, altAGL: 1500 });
  const mv = new M.Moves();
  for (let i = 0; i < 1200; i++) {
    for (const x of [a, b]) {
      x.controls.throttle = 1;
      x.controls.pitch = Math.sin(i / 90) * 0.2;
      x.controls.roll = Math.cos(i / 70) * 0.3;
    }
    mv.step(a, STEP, W, inner, a.controls);
    inner.call(b, STEP, W);
  }
  ok('with no trick running, his step is the flight model\'s own, to the last bit (his 1 km/h over Massimo is untouched)',
    a.pos.equals(b.pos) && a.vel.equals(b.vel) && a.quat.equals(b.quat) && P.SPEC.vne === P.SPEC.vne, `${a.pos.distanceTo(b.pos)} m apart after 10 s`);
}

/* -------------------------------------------------- the spin climb --- */
{
  const ac = make({ pos: new THREE.Vector3(-400, 0, 0), headingDeg: 90, engineOn: true });
  for (let i = 0; i < 360; i++) inner.call(ac, STEP, W);
  const mv = new M.Moves();
  mv.startSpin(ac);
  let up = null;
  let at500 = null;
  let maxBank = 0;
  let sig = 0;
  let steps = 0;
  let minTail = Infinity;
  fly(ac, mv, 30, null, (t) => {
    steps++;
    if (M.isSpinSignal(ac.controls)) sig++;
    maxBank = Math.max(maxBank, Math.abs(ac.bankAngleDeg()));
    if (up === null && ac.pitchAngleDeg() > 85) up = t;
    if (at500 === null && kt(ac) > 499) at500 = t;
    // His toes, 2.4 m behind his centre: never into the runway on the way up.
    const toe = new THREE.Vector3(0, 0.3, 2.42).applyQuaternion(ac.quat).add(ac.pos);
    minTail = Math.min(minTail, toe.y - Terrain.heightAt(toe.x, toe.z));
  });
  ok('spin climb from the runway: up off it with nothing touching — no crash, his toes clear of the ground', !ac.crashed && minTail > 0.1,
    `${ac.crashReason || 'flying'}, toes at least ${minTail.toFixed(2)} m clear`);
  ok('spin climb: he swings head-up to vertical within two seconds, wings level all the way (only his body spins, never the aeroplane)',
    up !== null && up < 2 && maxBank < 0.5, `vertical after ${up === null ? '—' : up.toFixed(2)} s, bank never past ${maxBank.toFixed(2)}°`);
  ok('spin climb: accelerating to 500 kt, then climbing at 500 kt straight up', at500 !== null && at500 < 16 && Math.abs(kt(ac) - 500) < 1 && ac.vs > 255,
    `500 kt after ${at500 === null ? '—' : at500.toFixed(1)} s; now ${kt(ac).toFixed(1)} kt, climbing ${ac.vs.toFixed(0)} m/s at ${ac.pos.y.toFixed(0)} m`);
  ok('spin climb: the spin pattern rides on the stick bytes the whole time he spins (that is how everybody sees it)', sig === steps, `${sig} of ${steps} steps`);
  // T again.
  mv.stop('key');
  let lvl = null;
  fly(ac, mv, 30, null, (t) => {
    if (mv.mode === 'off') {
      lvl = t;
      return true;
    }
    return false;
  });
  fly(ac, mv, 3);
  ok('T again: the spin stops and he eases back to level flight, flying on at his own speed', !ac.crashed && lvl !== null && lvl < 14 && Math.abs(ac.pitchAngleDeg()) < 12 && !M.isSpinSignal(ac.controls) && kt(ac) > 300,
    `level after ${lvl === null ? '—' : lvl.toFixed(1)} s, then ${kt(ac).toFixed(0)} kt, pitch ${ac.pitchAngleDeg().toFixed(1)}° at ${ac.pos.y.toFixed(0)} m`);
  // A firm pull stops it; a gentle one does not.
  const b = make({ pos: new THREE.Vector3(0, 0, 0), headingDeg: 90, engineOn: true, gearDown: false, speed: 180, altAGL: 1500 });
  const mb = new M.Moves();
  mb.startSpin(b);
  fly(b, mb, 3, () => ({ pitch: 0.45, roll: 0, throttle: 1 }));
  const gentle = mb.mode;
  fly(b, mb, 0.5, () => ({ pitch: -0.95, roll: 0, throttle: 1 }));
  ok('the stick: a gentle pull leaves him spinning, a firm push stops it', gentle === 'spin' && (mb.mode === 'level' || mb.mode === 'off') && mb.why === 'stick',
    `after a 0.45 pull: ${gentle}; after a firm push: ${mb.mode} (${mb.why})`);
  // The top of the world.
  const c = make({ pos: new THREE.Vector3(0, 0, 0), headingDeg: 90, engineOn: true, gearDown: false, speed: 200, altAGL: 8500 });
  const mc = new M.Moves();
  mc.startSpin(c);
  let top = 0;
  fly(c, mc, 60, null, () => {
    top = Math.max(top, c.pos.y);
    return mc.mode === 'off';
  });
  fly(c, mc, 10, null, () => {
    top = Math.max(top, c.pos.y);
  });
  ok('near the top of the world he stops climbing and levels off by himself — never through it', !c.crashed && mc.why === 'ceiling' && top < M.CEILING_M && top > M.CEILING_M - 900,
    `levelled off (${mc.why}) topping out at ${top.toFixed(0)} m of ${M.CEILING_M}`);
}

/* ------------------------------------------------------- the boost --- */
{
  const ac = make({ pos: new THREE.Vector3(0, 0, 0), headingDeg: 90, engineOn: true, gearDown: false, speed: 220, altAGL: 600 });
  const vne0 = P.SPEC.vne;
  const mv = new M.Moves();
  let overspeed = 0;
  let boom = 0;
  ac.on(P.EVENTS.OVERSPEED, () => overspeed++);
  mv.startBoost(ac);
  let at1000 = null;
  fly(ac, mv, 12, null, (t) => {
    if (at1000 === null && kt(ac) > 999.5) at1000 = t;
    if (mv.events.includes('boom')) boom = Math.max(boom, 1);
  });
  const mach = M.machOf(ac.vel.length(), ac.pos.y);
  ok('boost: 1000 kt head-first along his flight path — about Mach 1.5 low down — and held, with no overspeed and no coming apart',
    !ac.crashed && at1000 !== null && Math.abs(kt(ac) - 1000) < 0.5 && mach > 1.45 && overspeed === 0 && P.SPEC.vne > ac.ias,
    `1000 kt after ${at1000 === null ? '—' : at1000.toFixed(1)} s, Mach ${mach.toFixed(2)} at ${ac.pos.y.toFixed(0)} m, IAS ${(ac.ias * KT).toFixed(0)} kt, ${overspeed} overspeed warnings`);
  ok('boost: the sonic boom as he goes through Mach 1', mv.take().includes('boom') || boom > 0);
  // Flown with the stick: roll into a bank and pull.
  const h0 = ac.heading;
  const y0 = ac.pos.y;
  fly(ac, mv, 0.6, () => ({ pitch: 0, roll: 1, throttle: 1 }));
  const bank = ac.bankAngleDeg();
  fly(ac, mv, 8, () => ({ pitch: 0.6, roll: 0, throttle: 1 }));
  const turned = ((ac.heading - h0 + 540) % 360) - 180;
  ok('boost: you still fly him — the stick banks him and a pull turns him (wide, at 1000 kt), still at 1000 kt',
    bank > 50 && turned > 25 && Math.abs(kt(ac) - 1000) < 0.5 && !ac.crashed,
    `banked ${bank.toFixed(0)}°, then turned ${turned.toFixed(0)}° in 8 s pulling ${ac.gLoad.toFixed(1)} g; height ${(ac.pos.y - y0).toFixed(0)} m from where it was`);
  // The throttle to idle: he slows back down to his own speeds.
  fly(ac, mv, 0.5, () => ({ pitch: 0, roll: -0.6, throttle: 1 }));
  let off = null;
  fly(ac, mv, 30, () => ({ pitch: 0, roll: 0, throttle: 0 }), (t) => {
    if (mv.mode === 'off') {
      off = t;
      return true;
    }
    return false;
  });
  ok('boost: the throttle to idle and he eases back down to his own speeds; his red line is his own again',
    off !== null && mv.why === 'idle' && kt(ac) < 530 && P.SPEC.vne === vne0 && !ac.crashed,
    `handed back after ${off === null ? '—' : off.toFixed(1)} s at ${kt(ac).toFixed(0)} kt; red line ${(P.SPEC.vne * KT).toFixed(0)} kt`);
  // Into the sea at 1000 kt: an ordinary crash.
  const d = make({ pos: new THREE.Vector3(3000, 0, -3000), headingDeg: 180, engineOn: true, gearDown: false, speed: 250, altAGL: 150 });
  const md = new M.Moves();
  md.startBoost(d);
  fly(d, md, 8, () => ({ pitch: 0, roll: 0, throttle: 1 }));
  fly(d, md, 20, () => ({ pitch: -1, roll: 0, throttle: 1 }));
  ok('boost: hit something at 1000 kt and it is an ordinary crash', d.crashed && md.mode === 'off' && P.SPEC.vne === vne0, d.crashReason || 'no crash');
}

/* ------------------------------------------- they cancel each other --- */
{
  const ac = make({ pos: new THREE.Vector3(0, 0, 0), headingDeg: 90, engineOn: true, gearDown: false, speed: 220, altAGL: 2000 });
  const mv = new M.Moves();
  mv.startBoost(ac);
  fly(ac, mv, 9);
  const fast = kt(ac);
  mv.startSpin(ac);
  fly(ac, mv, 20);
  const spinKt = kt(ac);
  const spinUp = ac.pitchAngleDeg();
  mv.startBoost(ac);
  fly(ac, mv, 0.2);
  ok('the spin and the boost never fight: the spin takes over from the boost (back down to 500 kt), and the boost from the spin (no more spin pattern)',
    fast > 990 && mv.mode === 'boost' && Math.abs(spinKt - 500) < 2 && spinUp > 85 && !M.isSpinSignal(ac.controls) && !ac.crashed,
    `boost ${fast.toFixed(0)} kt -> spin ${spinKt.toFixed(0)} kt at ${spinUp.toFixed(0)}° -> ${mv.mode}`);
}

/* ------------------------------------------------------- P, P, P --- */
{
  const c = new M.PressCounter();
  const triple = [c.press(0), c.press(0.25), c.press(0.5)];
  const single = [c.press(2), c.tick(2.2), c.tick(2.41)];
  const dbl = [c.press(4), c.press(4.2), c.tick(4.7)];
  const slow = [c.press(6), c.tick(6.45), c.press(7), c.press(7.6), c.press(8.2)];
  ok('P P P: three presses inside a second are the boost, at once', triple[2] === 'triple' && !triple[0] && !triple[1]);
  ok('P: a single press is the autopilot — once, after waiting 0.4 s for more', single[0] === null && single[1] === null && single[2] === 'single');
  ok('P P: two presses toggle nothing (on and off again)', dbl[2] === 'double');
  ok('P ... P ... P spread over more than a second is not the boost', slow.every((x) => x !== 'triple'), JSON.stringify(slow));
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

/**
 * The stall speed on the HUD against the flight model, flown for real: the
 * owner's "add clock and stall speed too", and the rule that it is a real
 * figure and not a number off a table. Run with plain node:
 *
 *   node tests/features/stall-speed.mjs
 *
 *   1. CLmax is the lift line of physics.js at its stalling angle, flaps, ice
 *      and spoilers in; the figure is 0 on a helicopter.
 *   2. Weight, flaps and bank move it the way they must.
 *   3. FLOWN: a light aeroplane and airliners, clean and in landing flap, held
 *      level at idle while the speed bleeds off; the speed the wing lets go
 *      (the physics' own `stalled`) is within STALL_TOLERANCE_KT of the figure.
 *      Banked 45 degrees, level, the same.
 *   4. The figure is right at height too: it is indicated, not true.
 */
globalThis.document = {
  createElement: () => ({
    getContext: () => new Proxy({}, { get: () => () => ({ addColorStop() {}, data: new Uint8ClampedArray(4) }) }),
    width: 0, height: 0, style: {},
  }),
  body: { appendChild() {} },
};

const THREE = await import(new URL('../../src/vendor/three.module.js', import.meta.url).href);
const PH = await import(new URL('../../src/aircraft/physics.js', import.meta.url).href);
const { Aircraft, applyAircraft, UNITS } = PH;
const { Weather } = await import(new URL('../../src/world/weather.js', import.meta.url).href);
const { stallKnots, stallKnotsNow, clMax } = await import(new URL('../../src/features/stall-speed.js', import.meta.url).href);
const { getAircraft, performanceFor } = await import(new URL('../../src/aircraft/types.js', import.meta.url).href);

let passed = 0;
let failed = 0;
const ok = (n, p, d = '') => {
  if (p) passed++;
  else failed++;
  console.log(`${p ? 'PASS' : 'FAIL'} ${n}${d ? ` -- ${d}` : ''}`);
};

export const STALL_TOLERANCE_KT = 4;
const KT = UNITS.KTS;
/** The numbers physics.js flies with: the type's aero over the defaults, not the bare table entry. */
const spec = (id) => {
  applyAircraft(id);
  return PH.SPEC;
};

/* ---- 1, 2 ---- */
const sk = spec('skylark');
ok('CLmax: clean is CL0 + CLa * alphaStall', Math.abs(clMax(sk) - (sk.CL0 + sk.CLa * sk.alphaStall)) < 1e-9);
ok('CLmax: full flap adds 0.62, and takes 0.03 rad off the stalling angle', Math.abs(clMax(sk, 1) - (sk.CL0 + 0.62 + sk.CLa * (sk.alphaStall - 0.03))) < 1e-9);
ok('CLmax: ice takes 0.06 rad off', Math.abs(clMax(sk, 0) - clMax(sk, 0, true) - sk.CLa * 0.06) < 1e-9);
ok('rotor: no stall speed on a helicopter', stallKnots(spec('harrier')) === 0);
const v0 = stallKnots(sk);
ok('the Skylark clean is its table figure', Math.abs(v0 - performanceFor('skylark').stallClean) < 1, `${v0.toFixed(1)} kt`);
ok('flaps lower it', stallKnots(sk, { flaps: 1 }) < v0 - 4, `${stallKnots(sk, { flaps: 1 }).toFixed(1)} kt`);
ok('weight raises it by the root of the mass', Math.abs(stallKnots(sk, { extraMass: sk.mass * 0.44 }) / v0 - 1.2) < 0.001);
ok('a 60 degree bank is 2 g: root two times', Math.abs(stallKnots(sk, { bankDeg: 60 }) / v0 - Math.SQRT2) < 0.001);
ok('bank either way is the same', stallKnots(sk, { bankDeg: -60 }) === stallKnots(sk, { bankDeg: 60 }));
ok('past 70 degrees it is capped, never infinite', Number.isFinite(stallKnots(sk, { bankDeg: 120 })) && stallKnots(sk, { bankDeg: 120 }) === stallKnots(sk, { bankDeg: 70 }));

/* ---- 3, 4: flown ---- */
/** Wings at `bankDeg`, height held, idle, until the wing stalls. Returns { ias, shown, bank, alt }. */
function flyToStall(id, { flaps = 0, bankDeg = 0, altM = 600 } = {}) {
  applyAircraft(id);
  const a = new Aircraft();
  a.mode = 'realistic';
  a.difficulty = 'realistic';
  const w = new Weather();
  w.windSpeedKts = 0;
  w.setCondition && w.setCondition('clear');
  const start = (stallKnots(spec(id), { flaps, bankDeg }) * 1.25) / KT / Math.sqrt(Math.exp(-altM / 8500));
  a.reset({ pos: new THREE.Vector3(9000, altM, 9000), headingDeg: 90, speed: start, altAGL: null, gearDown: false, engineOn: true });
  a._spawnOnGround = false;
  a.onGround = false;
  a.pos.y = altM;
  a.flaps = flaps;
  a.controls.flaps = flaps;
  const fstep = a.flapStep ? a.flapStep() : 0;
  a.controls.throttle = 0;
  a.rpm = 0;
  a.gearDown = false;
  a.gearPos = 0;
  const y0 = a.pos.y;
  const dt = 1 / 120;
  const Q = new THREE.Quaternion();
  const E = new THREE.Euler(0, 0, 0, 'YXZ');
  let pitch = 0.08;
  for (let i = 0; i < 120 * 150; i++) {
    // Held by attitude: the nose is raised to keep the height, wings where they are asked.
    const vy = a.vel.y;
    pitch += (-(a.pos.y - y0) * 0.004 - vy * 0.012) * dt * 60 * 0.05;
    E.set(pitch, THREE.MathUtils.degToRad(-90), THREE.MathUtils.degToRad(-bankDeg));
    Q.setFromEuler(E);
    a.quat.copy(Q);
    a.omega.set(0, 0, 0);
    a.flaps = flaps;
    a.update(dt, w);
    if (a.crashed) return { crashed: a.crashReason };
    if (a.stalled) return { ias: a.ias * KT, shown: stallKnotsNow(a), bank: a.bankAngleDeg(), alt: a.pos.y, dy: a.pos.y - y0, g: a.gLoad, vs: a.vel.y, fstep };
  }
  return { never: true, ias: a.ias * KT };
}

for (const [id, name] of [['skylark', 'light aeroplane'], ['courier', 'tourer'], ['a320', 'airliner'], ['b747', 'big airliner']]) {
  for (const flaps of [0, 1]) {
    const r = flyToStall(id, { flaps });
    const conf = flaps ? 'landing flap' : 'clean';
    ok(`flown: ${name} (${id}), ${conf}: the wing lets go at the figure`, r.ias && Math.abs(r.ias - r.shown) <= STALL_TOLERANCE_KT, JSON.stringify({ stalledAt: r.ias && +r.ias.toFixed(1), shown: r.shown && +r.shown.toFixed(1), table: flaps ? performanceFor(id).stallLanding : performanceFor(id).stallClean, dy: r.dy && +r.dy.toFixed(1), crashed: r.crashed, never: r.never }));
  }
}
for (const [id, name] of [['skylark', 'light aeroplane'], ['a320', 'airliner']]) {
  const r = flyToStall(id, { bankDeg: 45 });
  ok(`flown: ${name}, 45 degree level turn`, r.ias && Math.abs(r.ias - r.shown) <= STALL_TOLERANCE_KT + 1, JSON.stringify({ stalledAt: r.ias && +r.ias.toFixed(1), shown: r.shown && +r.shown.toFixed(1), bank: r.bank && +r.bank.toFixed(1), dy: r.dy && +r.dy.toFixed(1) }));
  const hi = flyToStall(id, { altM: 3000 });
  ok(`flown: ${name}, at 10,000 ft the indicated figure holds`, hi.ias && Math.abs(hi.ias - hi.shown) <= STALL_TOLERANCE_KT, JSON.stringify({ stalledAt: hi.ias && +hi.ias.toFixed(1), shown: hi.shown && +hi.shown.toFixed(1) }));
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

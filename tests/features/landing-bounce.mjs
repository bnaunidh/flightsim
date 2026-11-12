/**
 * The touchdown bounce (the owner, 2026-11-11: "the harder the landing in bigger planes you might bounce
 * up a bit"), flown headless on the real flight model and the real runway. Run with plain node:
 *
 *   node tests/features/landing-bounce.mjs
 *
 *   1. THE LAW (physics.js reboundSpeed): nothing for a greaser, more for a harder arrival, most on a
 *      heavy type, never more than REBOUND of the sink or REBOUND_MAX, none on a rotor or on floats.
 *   2. FLOWN: airliners, a cargo jet and light singles brought onto the runway in a steady descent at a
 *      held attitude (the speed trimmed until lift = weight), then left hands off. A greaser stays down;
 *      a firm one is a small hop; a hard one a bigger bounce, bounded; everything settles in seconds;
 *      the light ones do not bounce; an arrival past the limit is still a crash.
 *   3. THE GRADE: the bounce is one landing. The card's sink and grade are the first touch's, the later
 *      touches carry `bounce`, and coming off the wheels is a 'bounce' event, not a take-off.
 *   4. NOTHING ELSE MOVES: parked and taxiing aeroplanes never bounce; a take-off is still one lift-off.
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
const { stallKnots } = await import(SRC + 'features/stall-speed.js');
const { RUNWAY_START } = await import(SRC + 'game/missions.js');
TER.applyMap(TER.MAP.id);

let passed = 0;
let failed = 0;
const ok = (n, p, d = '') => {
  if (p) passed++;
  else failed++;
  console.log(`${p ? 'PASS' : 'FAIL'} ${n}${d !== '' ? ` -- ${d}` : ''}`);
};
const f2 = (v) => (Math.round(v * 100) / 100).toString();
const FPM = 196.85;
const DT = 1 / 120;
const weather = {
  windVector: (o) => (o || new THREE.Vector3()).set(0, 0, 0),
  gustVector: (o) => (o || new THREE.Vector3()).set(0, 0, 0),
  turbulenceLevel: () => 0,
  cond: { rain: 0, cloud: 0 },
  time_s: 0,
  downdraft: 0,
  vortex: null,
};
const X = new THREE.Vector3(1, 0, 0);
const tv = new THREE.Vector3();
/** How far the lower main wheel is off the ground, metres. */
function mainClear(ac) {
  let m = Infinity;
  for (const g of P.SPEC.gearPoints) {
    if (!g.brake) continue;
    tv.copy(g.pos).applyQuaternion(ac.quat).add(ac.pos);
    m = Math.min(m, tv.y - TER.heightAt(tv.x, tv.z));
  }
  return m;
}
function listen(ac) {
  const ev = { touch: [], bounce: 0, liftoff: 0 };
  ac.on(P.EVENTS.TOUCHDOWN, (g) => ev.touch.push({ ...g }));
  ac.on(P.EVENTS.BOUNCE, () => ev.bounce++);
  ac.on(P.EVENTS.LIFTOFF, () => ev.liftoff++);
  return ev;
}

/**
 * Bring `id` onto the runway sinking at `fpm` with the nose held `pitchDeg` up, then hands off for
 * `seconds`. Until the wheels touch, the attitude and the sink are held and the speed is trimmed so the
 * wing carries the weight: a steady approach, not a drop.
 */
function land(id, fpm, { mode = 'simplified', difficulty = 'normal', pitchDeg = 3, seconds = 8, spoilers = true } = {}) {
  P.applyAircraft(id);
  const ac = new P.Aircraft();
  ac.mode = mode;
  ac.difficulty = difficulty;
  ac.reset({ ...RUNWAY_START, engineOn: true });
  const y0 = ac.pos.y; // standing on its wheels
  const v = (stallKnots(P.SPEC, { flaps: 1 }) * 1.3) / P.UNITS.KTS;
  const vs = fpm / FPM;
  ac.reset({ ...RUNWAY_START, engineOn: true, altAGL: 30, speed: v });
  ac._spawnOnGround = false;
  ac.onGround = false;
  ac.spoilersArmed = spoilers;
  const ev = listen(ac);
  const q0 = ac.quat.clone();
  const dq = new THREE.Quaternion().setFromAxisAngle(X, pitchDeg / 57.2958);
  let sp = v;
  let touched = -1;
  let t = 0;
  let hop = 0;
  let upMax = 0;
  let lastAir = -1;
  let was = false;
  let restY = 0;
  for (let f = 0; f < (seconds + 8) * 120; f++) {
    if (touched < 0) {
      const h = Math.hypot(ac.vel.x, ac.vel.z) || 1;
      ac.vel.x *= sp / h;
      ac.vel.z *= sp / h;
      ac.quat.copy(q0).multiply(dq);
      ac.omega.set(0, 0, 0);
      if (f < 600) ac.pos.y = y0 + 2.5;
      ac.vel.y = -vs;
      Object.assign(ac.controls, { throttle: 0.2, pitch: 0, roll: 0, yaw: 0, brakes: 0 });
    } else Object.assign(ac.controls, { throttle: 0, pitch: 0, roll: 0, yaw: 0, brakes: 0 });
    ac.flaps = 1;
    ac.update(DT, weather);
    t += DT;
    if (!ac.onGround && touched < 0 && f < 600) sp = Math.max(v * 0.7, Math.min(v * 2, sp - (ac.vel.y + vs) * 5));
    if (ac.crashed) break;
    if (ac.onGround && !was && touched < 0) touched = t;
    if (touched >= 0) {
      if (!ac.onGround) {
        lastAir = t;
        hop = Math.max(hop, mainClear(ac));
      }
      if (t - touched > 0.05) upMax = Math.max(upMax, ac.vel.y);
      if (t - touched > seconds) break;
    }
    was = ac.onGround;
    restY = ac.pos.y - y0;
  }
  return {
    id, fpm, ac, ev, crashed: ac.crashed, why: ac.crashReason, hop, upMax,
    airFor: lastAir < 0 ? 0 : lastAir - touched,
    down: ac.onGround && Math.abs(ac.vel.y) < 0.1 && Math.abs(restY) < 0.15,
    last: ac.lastTouchdown,
  };
}

/* ---- 1. the law ------------------------------------------------------------ */
const spec = (id) => {
  P.applyAircraft(id);
  return P.SPEC;
};
const HEAVY = ['b737', 'a380', 'c5'];
const LIGHT = ['skylark', 'courier'];
{
  const big = spec('a380');
  ok('law: a greaser (150 fpm) gives nothing back', P.reboundSpeed(150 / FPM, big) === 0);
  ok('law: 200 fpm gives nothing back either', P.reboundSpeed(200 / FPM, big) === 0);
  let mono = true;
  let under = true;
  let prev = 0;
  for (let fpm = 0; fpm <= 1400; fpm += 10) {
    const r = P.reboundSpeed(fpm / FPM, big);
    if (r < prev - 1e-9) mono = false;
    if (r > P.REBOUND * (fpm / FPM) + 1e-9 || r > P.REBOUND_MAX + 1e-9) under = false;
    prev = r;
  }
  ok('law: harder never bounces less', mono);
  ok('law: never more than REBOUND of the sink, never over REBOUND_MAX (no energy made)', under && P.REBOUND < 1, `REBOUND ${P.REBOUND}, max ${P.REBOUND_MAX} m/s`);
  const s = 700 / FPM;
  const rs = Object.fromEntries(['skylark', 'f22', 'q400', 'b737', 'a380'].map((id) => [id, P.reboundSpeed(s, spec(id))]));
  ok('law: by weight -- the trainer least, a fighter more, an airliner most', rs.skylark < rs.f22 && rs.f22 < rs.q400 && rs.q400 <= rs.b737 && rs.b737 === rs.a380, JSON.stringify(Object.fromEntries(Object.entries(rs).map(([k, v]) => [k, +f2(v)]))));
  ok('law: a light single gets under a quarter of an airliner\'s', rs.skylark < rs.a380 / 4);
  const rotors = T.AIRCRAFT.filter((a) => spec(a.id).rotor);
  ok('law: no helicopter bounces', rotors.length > 0 && rotors.every((a) => P.reboundSpeed(4, spec(a.id)) === 0), `${rotors.length} rotorcraft`);
  const floats = T.AIRCRAFT.filter((a) => spec(a.id).floats);
  ok('law: nothing on floats bounces', floats.every((a) => P.reboundSpeed(4, spec(a.id)) === 0), `${floats.length} floatplanes`);
}

/* ---- 2, 3. flown ------------------------------------------------------------ */
const hops = {};
for (const id of [...HEAVY, ...LIGHT]) {
  const heavy = HEAVY.includes(id);
  const g = land(id, 120);
  ok(`${id}: a greaser (120 fpm) stays down`, !g.crashed && g.hop < 0.02 && g.ev.bounce === 0 && g.ev.touch.length === 1 && g.down, `hop ${f2(g.hop)} m, ${g.ev.touch.length} touch, ${g.last && g.last.quality}`);
  const soft = land(id, 220);
  ok(`${id}: a good landing (220 fpm) stays down`, !soft.crashed && soft.hop < 0.02 && soft.ev.bounce === 0 && soft.down, `hop ${f2(soft.hop)} m`);
  const firm = land(id, 500);
  const hard = land(id, 800);
  hops[id] = { firm: firm.hop, hard: hard.hop };
  if (heavy) {
    ok(`${id}: a firm landing (500 fpm) is a small hop`, !firm.crashed && firm.hop > 0.03 && firm.hop < 0.6, `${f2(firm.hop)} m, off the wheels ${f2(firm.airFor)} s`);
    ok(`${id}: a hard landing (800 fpm) is a bigger bounce, and bounded`, !hard.crashed && hard.hop > firm.hop + 0.2 && hard.hop > 0.3 && hard.hop < 2.5, `${f2(hard.hop)} m, off the wheels ${f2(hard.airFor)} s`);
    ok(`${id}: it comes off slower than it arrived`, hard.upMax < P.REBOUND_MAX + 0.6 && hard.upMax < 800 / FPM, `${f2(hard.upMax)} m/s up from ${f2(800 / FPM)} m/s down`);
    ok(`${id}: the bounce is a 'bounce', not a take-off`, hard.ev.bounce >= 1 && hard.ev.liftoff === 0 && firm.ev.liftoff === 0, `${hard.ev.bounce} bounce, ${hard.ev.liftoff} lift-off`);
    const t0 = hard.ev.touch[0];
    const later = hard.ev.touch.slice(1);
    ok(`${id}: the first touch is the landing, the later ones carry 'bounce'`, t0 && !t0.bounce && later.length >= 1 && later.every((x) => x.bounce >= 1), `${hard.ev.touch.map((x) => `${x.vsFpm}${x.bounce ? 'b' : ''}`).join(', ')} fpm`);
    ok(`${id}: the grade stays the hard one (a soft second touch does not launder it)`, hard.last && hard.last.quality === 'rough' && Math.abs(hard.last.vsFpm - 800) < 30, hard.last ? `${hard.last.quality}, ${hard.last.vsFpm} fpm, ${hard.last.score}` : 'none');
    ok(`${id}: each touch is softer than the one before`, later.every((x, i) => Math.abs(x.vsFpm) < Math.abs(hard.ev.touch[i].vsFpm)), '');
  } else {
    ok(`${id}: a light aeroplane barely leaves the ground, firm or hard`, !firm.crashed && !hard.crashed && firm.hop < 0.05 && hard.hop < 0.08, `${f2(firm.hop)} m, ${f2(hard.hop)} m`);
  }
  ok(`${id}: firm and hard both settle within 5 s, standing on the wheels`, firm.down && hard.down && firm.airFor < 5 && hard.airFor < 5, `last off the wheels ${f2(firm.airFor)} s, ${f2(hard.airFor)} s after touching`);
  const over = land(id, 1000);
  ok(`${id}: 1,000 fpm is still a crash`, over.crashed && /too fast/.test(over.why), over.why || 'no crash');
  const real = land(id, 870, { difficulty: 'realistic' });
  ok(`${id}: realistic difficulty still breaks it at 870 fpm`, real.crashed && /too fast/.test(real.why), real.why || 'no crash');
}
ok('the airliners bounce more than the light ones', HEAVY.every((h) => LIGHT.every((l) => hops[h].hard > hops[l].hard + 0.2)), JSON.stringify(Object.fromEntries(Object.entries(hops).map(([k, v]) => [k, +f2(v.hard)]))));

// Other attitudes, the unassisted flight model, the easy limit, the spoilers left stowed.
for (const id of [...HEAVY, 'c17']) {
  let worst = 0;
  let worstAir = 0;
  let allDown = true;
  let crashes = 0;
  for (const mode of ['simplified', 'realistic']) for (const pitchDeg of [1, 3, 6]) for (const fpm of [450, 650, 850]) for (const spoilers of [true, false]) {
    const r = land(id, fpm, { mode, pitchDeg, spoilers });
    if (r.crashed) crashes++;
    else {
      worst = Math.max(worst, r.hop);
      worstAir = Math.max(worstAir, r.airFor);
      if (!r.down) allDown = false;
    }
  }
  ok(`${id}: both flight models, three attitudes, spoilers armed or not -- never over 2.5 m, down within 6 s, no crash`, crashes === 0 && worst < 2.5 && worstAir < 6 && allDown, `highest ${f2(worst)} m, longest ${f2(worstAir)} s, ${crashes} crashes`);
  const easy = land(id, 1150, { difficulty: 'easy' });
  ok(`${id}: easy lets 1,150 fpm through as a big bounce, under 3 m, and it settles`, !easy.crashed && easy.hop > 0.3 && easy.hop < 3 && easy.down, `${f2(easy.hop)} m, ${f2(easy.airFor)} s`);
  const easyOver = land(id, 1450, { difficulty: 'easy' });
  ok(`${id}: easy still breaks it at 1,450 fpm`, easyOver.crashed, easyOver.why || 'no crash');
}

/* ---- 4. nothing else moves ---------------------------------------------------- */
for (const id of ['a380', 'b737', 'skylark']) {
  // Parked, then taxied.
  P.applyAircraft(id);
  const ac = new P.Aircraft();
  ac.reset({ ...RUNWAY_START, engineOn: true });
  const ev = listen(ac);
  const y0 = ac.pos.y;
  let dy = 0;
  let pushed = false;
  ac.parkingBrake = true;
  for (let f = 0; f < 5 * 120; f++) {
    Object.assign(ac.controls, { throttle: 0, pitch: 0, roll: 0, yaw: 0, brakes: 0 });
    ac.update(DT, weather);
    dy = Math.max(dy, Math.abs(ac.pos.y - y0));
    if (ac._reb) pushed = true;
  }
  ok(`${id}: parked 5 s -- no bounce, no touchdown, height within 2 cm`, !ac.crashed && ac.onGround && ev.bounce === 0 && ev.touch.length === 0 && !pushed && dy < 0.02, `${f2(dy * 100)} cm`);
  ac.parkingBrake = false;
  let offGround = 0;
  let vMax = 0;
  for (let f = 0; f < 20 * 120; f++) {
    const fast = ac.groundSpeed > 9;
    Object.assign(ac.controls, { throttle: fast ? 0 : 0.45, pitch: 0, roll: 0, yaw: 0, brakes: f > 16 * 120 ? 1 : 0 });
    ac.update(DT, weather);
    if (!ac.onGround) offGround++;
    vMax = Math.max(vMax, ac.groundSpeed);
    dy = Math.max(dy, Math.abs(ac.pos.y - y0));
    if (ac._reb) pushed = true;
  }
  ok(`${id}: taxied 20 s and braked -- wheels never leave the ground, no bounce`, !ac.crashed && offGround === 0 && ev.bounce === 0 && ev.touch.length === 0 && !pushed && vMax > 3 && dy < 0.12, `up to ${f2(vMax)} m/s, height within ${f2(dy * 100)} cm`);
}
for (const id of ['b737', 'skylark']) {
  P.applyAircraft(id);
  const ac = new P.Aircraft();
  ac.reset({ ...RUNWAY_START, engineOn: true });
  const ev = listen(ac);
  const vr = (stallKnots(P.SPEC, { flaps: 0 }) * 1.15) / P.UNITS.KTS;
  let pushed = false;
  for (let f = 0; f < 60 * 120 && !(ac.agl > 15) && !ac.crashed; f++) {
    Object.assign(ac.controls, { throttle: 1, pitch: ac.ias > vr ? 0.35 : 0, roll: 0, yaw: 0, brakes: 0 });
    ac.update(DT, weather);
    if (ac._reb) pushed = true;
  }
  ok(`${id}: a take-off is one lift-off and no bounce`, !ac.crashed && ac.agl > 15 && ev.liftoff === 1 && ev.bounce === 0 && !pushed, `${ev.liftoff} lift-off, ${ev.bounce} bounce, ${ev.touch.length} touchdown${ac.crashed ? ', ' + ac.crashReason : ''}`);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

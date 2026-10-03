/**
 * Node checks for the custom crashes, the crash marks and the wildfire
 * disaster. Run with plain node:
 *
 *   node tests/features/crashes.mjs
 *
 *   1. Which crash is which (features/crashes/kinds.js): a made-up impact
 *      of every sort is named the way a spectator would name it.
 *   2. The captions: several for each, short, and never about anybody being
 *      hurt.
 *   3. The choreography (crashes/motion.js), every kind on a trainer and on
 *      a jumbo: finishes in time, never jumps, never goes under the ground
 *      it lies on (the nose plant's nose and the splash's dive excepted, by
 *      design and by exactly how much).
 *   4. The minimap marks (crashes/marks.js): merged, capped, faded, pruned,
 *      and drawn only on their own map and inside the circle.
 *   5. The happenings API (game/happenings.js) the multiplayer team syncs:
 *      listeners, a listener that throws, junk that must be refused, the
 *      receivers, the summon point.
 *   6. The wildfire in the disasters list (game/disasters.js +
 *      features/wildfire-disaster.js): selectable, in the random pool,
 *      never twice.
 */

// wildfire.js paints two small textures when it is imported.
globalThis.document = {
  createElement: () => ({
    getContext: () => new Proxy({}, { get: () => () => ({ addColorStop() {}, data: new Uint8ClampedArray(4) }) }),
    width: 0,
    height: 0,
    style: {},
  }),
  body: { appendChild() {} },
};

const root = new URL('../../src/', import.meta.url);
const THREE = await import(new URL('vendor/three.module.js', root));
const K = await import(new URL('features/crashes/kinds.js', root));
const M = await import(new URL('features/crashes/motion.js', root));
const MK = await import(new URL('features/crashes/marks.js', root));
const H = await import(new URL('game/happenings.js', root));
const DIS = await import(new URL('game/disasters.js', root));

let pass = 0;
let fail = 0;
function ok(name, cond, detail = '') {
  if (cond) pass++;
  else fail++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
}

/* ---- 1. which crash is which --------------------------------------- */
const V = (x, y, z) => new THREE.Vector3(x, y, z);
function attitude(pitchDeg, bankDeg, hdgDeg = 0) {
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler((pitchDeg * Math.PI) / 180, (-hdgDeg * Math.PI) / 180, (-bankDeg * Math.PI) / 180, 'YXZ'));
  return { q, forward: V(0, 0, -1).applyQuaternion(q), right: V(1, 0, 0).applyQuaternion(q) };
}
const cases = [
  ['the sea, however it hit', { reason: 'You flew into the sea', surface: 'water', vel: V(0, -20, -60), ...attitude(-30, 40), agl: 0 }, 'splash'],
  ['over water, low, no reason given', { vel: V(0, -3, -40), ...attitude(0, 0), agl: 1, overWater: true }, 'splash'],
  ['a building', { reason: 'You flew into the control tower', surface: 'concrete', vel: V(0, 0, -40), ...attitude(0, 0), agl: 20 }, 'bonk'],
  ['steep dive', { reason: 'You came down far too fast', part: 'fuselage', vel: V(0, -35, -30), ...attitude(-50, 0), agl: 1 }, 'noseplant'],
  ['nose first, moderately steep', { reason: 'The propeller struck the ground', part: 'nose', vel: V(0, -20, -35), ...attitude(-20, 0), agl: 1 }, 'noseplant'],
  ['wing tip, slow', { reason: 'The left wing tip hit the ground', part: 'leftWing', vel: V(0, -3, -30), ...attitude(0, -40), agl: 3 }, 'wingclip'],
  ['wing tip, fast', { reason: 'The right wing tip hit the ground', part: 'rightWing', vel: V(0, -6, -70), ...attitude(-3, 55), agl: 3 }, 'cartwheel'],
  ['steep bank, no part named', { vel: V(0, -4, -40), ...attitude(0, 60), agl: 2 }, 'wingclip'],
  ['flat and fast: belly', { reason: 'The belly hit the ground', part: 'fuselage', vel: V(0, -4, -45), ...attitude(1, 0), agl: 1 }, 'bellyflop'],
  ['wheels up landing', { reason: 'You landed with the wheels up', part: 'fuselage', vel: V(0, -2, -35), ...attitude(2, 0), agl: 1 }, 'bellyflop'],
  ['very fast, fairly steep', { reason: 'Way too fast for a landing', vel: V(0, -22, -85), ...attitude(-8, 0), agl: 1 }, 'cartwheel'],
  ['came apart in the air', { reason: 'Too fast — the aeroplane came apart', vel: V(0, -30, -120), ...attitude(-10, 0), agl: 300 }, 'cartwheel'],
  ['another aeroplane, up in the air (sky.js)', { reason: 'You flew into Island 47', surface: 'aircraft', vel: V(0, 0, -60), ...attitude(0, 0), agl: 400 }, 'midair'],
  ['another aeroplane, on the apron', { reason: 'You taxied into Island 47', surface: 'aircraft', vel: V(0, 0, -4), ...attitude(0, 0), agl: 0.8 }, 'bonk'],
  ['a jumbo on one wing tip is not "in the air"', { part: 'leftWing', vel: V(0, -3, -30), ...attitude(0, -50), agl: 14, size: 18 }, 'wingclip'],
];
for (const [name, info, want] of cases) {
  const got = K.classifyCrash(info);
  ok(`kinds: ${name} → ${want}`, got.kind === want, `got ${got.kind} (pitch ${got.pitch.toFixed(0)}, bank ${got.bank.toFixed(0)}, γ ${got.gamma.toFixed(0)}, ${got.speed.toFixed(0)} m/s)`);
}
ok('kinds: the low wing is the side it spins to', K.classifyCrash({ part: 'rightWing', vel: V(0, -3, -30), ...attitude(0, 40) }).side === 1 && K.classifyCrash({ part: 'leftWing', vel: V(0, -3, -30), ...attitude(0, -40) }).side === -1);
ok('kinds: nothing given is still a crash with a name', K.KIND_IDS.includes(K.classifyCrash({}).kind));
ok('kinds: the six the list asked for plus the mid-air bump, and the same seven happenings.js sends', K.KIND_IDS.length === 7 && K.KIND_IDS.every((k) => H.CRASH_KINDS.includes(k)));

/* ---- 2. captions ----------------------------------------------------- */
const BANNED = /\b(die|died|dead|death|blood|hurt|injur|kill|gore|body|bodies|pain|broken bone|funeral|ambulance)/i;
for (const id of K.KIND_IDS) {
  const k = K.KINDS[id];
  const all = [k.title, k.heliTitle, k.word, ...k.captions];
  ok(`captions: ${id} has at least three jokes, all short`, k.captions.length >= 3 && k.captions.every((c) => c.length <= 64), k.captions.map((c) => c.length).join(','));
  ok(`captions: ${id} is kid-safe`, all.every((t) => !BANNED.test(t)), all.filter((t) => BANNED.test(t)).join(' | '));
  ok(`captions: ${id} has a comic word that fits the burst`, k.word.length <= 11 && /!$/.test(k.word), k.word);
}
{
  let last = null;
  let repeats = 0;
  for (let i = 0; i < 200; i++) {
    const c = K.pickCaption('cartwheel', last);
    if (c === last) repeats++;
    last = c;
  }
  ok('captions: never the same joke twice in a row', repeats === 0, `${repeats} repeats`);
}
ok('captions: a helicopter\'s wing clip is a rotor clip', K.titleFor('wingclip', 'heli') === 'Rotor-clip spin!' && K.titleFor('wingclip', 'plane') === 'Wing-clip spin!');

/* ---- 3. the choreography --------------------------------------------- */
const TRAINER = M.dimsFrom([
  { part: 'nose', pos: V(0, -0.9, -2.8) },
  { part: 'leftWing', pos: V(-6.1, 0.3, -0.5) },
  { part: 'rightWing', pos: V(6.1, 0.3, -0.5) },
  { part: 'tail', pos: V(0, -0.1, 4.6) },
  { part: 'fuselage', pos: V(0, -0.8, 0.3) },
]);
const JUMBO = M.dimsFrom(null, { nose: -16.8, tail: 20.77, span: 35.8 });
ok('motion: sizes come from the strike points', Math.abs(TRAINER.semi - 6.1) < 1e-6 && Math.abs(TRAINER.r - 0.8) < 1e-6 && TRAINER.L > 7, JSON.stringify(TRAINER));
ok('motion: …or from the plan when there are none', Math.abs(JUMBO.semi - 17.9) < 1e-6 && JUMBO.L > 37, JSON.stringify(JUMBO));
const hilly = (x, z) => 12 + Math.sin(x / 40) * 3 + Math.cos(z / 55) * 2;
const sea = () => 0;
for (const [label, dims] of [['trainer', TRAINER], ['jumbo', JUMBO]]) {
  for (const kind of K.KIND_IDS) {
    const ground = kind === 'splash' ? sea : hilly;
    const att = attitude(kind === 'noseplant' ? -45 : 0, kind === 'wingclip' ? -40 : kind === 'cartwheel' ? 55 : 0, 70);
    const p0 = V(100, 0, -50);
    p0.y = ground(p0.x, p0.z) + (kind === 'bonk' ? 16 : kind === 'splash' ? 0.5 : dims.r + 0.5);
    const vel = V(Math.sin((70 * Math.PI) / 180) * 45, kind === 'noseplant' ? -30 : -4, -Math.cos((70 * Math.PI) / 180) * 45);
    const s = M.makeScript(kind, { pos: p0, quat: att.q, vel, side: -1, dims, ground, agl: p0.y - ground(p0.x, p0.z) });
    let t = 0;
    let maxJump = 0;
    let below = Infinity;
    let finite = true;
    let normal = true;
    let prev = p0.clone();
    let firstJump = 0;
    while (!s.done && t < 5) {
      t += 1 / 60;
      M.poseAt(s, t);
      const jump = s.pos.distanceTo(prev);
      if (t < 1.5 / 60) firstJump = jump;
      maxJump = Math.max(maxJump, jump);
      prev = s.pos.clone();
      below = Math.min(below, s.pos.y - ground(s.pos.x, s.pos.z));
      finite = finite && [s.pos.x, s.pos.y, s.pos.z].every(Number.isFinite);
      normal = normal && Math.abs(s.quat.length() - 1) < 1e-4;
    }
    const tag = `motion: ${label} ${kind}`;
    ok(`${tag} is over by ${M.CRASH_SECONDS}s, before the debrief`, s.done && t <= M.CRASH_SECONDS + 0.02, `${t.toFixed(2)} s`);
    ok(`${tag} stays a real place and a real rotation`, finite && normal);
    // A cartwheel is the fastest thing here: 34 m/s along the ground at most,
    // plus a tip swinging round; a frame's worth of that is under 2 m.
    ok(`${tag} never jumps (${maxJump.toFixed(2)} m in a frame at most)`, maxJump < (label === 'jumbo' ? 3.2 : 2), `first frame ${firstJump.toFixed(2)} m`);
    const floor = kind === 'noseplant' ? -Math.abs(dims.noseZ) * 1.2 : kind === 'splash' ? -dims.r * 1.6 : -0.01;
    ok(`${tag} never goes under what it lies on`, below >= floor, `${below.toFixed(2)} m (allowed ${floor.toFixed(2)})`);
    if (kind === 'noseplant') {
      const nose = V(0, dims.noseY, dims.noseZ).applyQuaternion(s.quat).add(s.pos);
      const tail = V(0, 0, dims.tailZ).applyQuaternion(s.quat).add(s.pos);
      ok(`${tag}: nose in the ground, tail in the air`, nose.y < ground(nose.x, nose.z) + 0.05 && tail.y > ground(tail.x, tail.z) + dims.L * 0.3, `nose ${(nose.y - ground(nose.x, nose.z)).toFixed(2)}, tail ${(tail.y - ground(tail.x, tail.z)).toFixed(1)}`);
    }
    if (kind === 'cartwheel') {
      const up = V(0, 1, 0).applyQuaternion(s.quat);
      ok(`${tag} ends upside down`, up.y < -0.8, `up.y ${up.y.toFixed(2)}`);
      const want = dims.semi > 9 ? 1 : 2;
      ok(`${tag}: a wing tip hits the ground ${want === 1 ? 'on the way over' : 'at least twice on the way'}`, s.slams >= want, `${s.slams}`);
    }
    if (kind === 'wingclip') {
      const f0 = V(0, 0, -1).applyQuaternion(att.q).setY(0).normalize();
      ok(`${tag} spins round (it faces somewhere else at the end)`, s.slams >= 2, `${s.slams} turns`);
      void f0;
    }
    if (kind === 'splash') ok(`${tag} ends afloat`, s.pos.y > -dims.r * 0.3 && s.pos.y < dims.r * 1.2, `${s.pos.y.toFixed(2)} m`);
  }
}

/* ---- 4. the marks ------------------------------------------------------ */
{
  const m = new MK.CrashMarks();
  m.add({ x: 0, z: 0, kind: 'cartwheel', map: 'kestrel', mine: true, now: 0 });
  m.add({ x: 30, z: 20, kind: 'bonk', map: 'kestrel', mine: true, now: 1 });
  ok('marks: two crashes in the same place are one mark with a count', m.list.length === 1 && m.list[0].count === 2 && m.list[0].kind === 'bonk');
  m.add({ x: 30, z: 20, kind: 'bonk', map: 'harrier', mine: true, now: 1 });
  ok('marks: …but not on another map', m.list.length === 2);
  for (let i = 0; i < 20; i++) m.add({ x: i * 500, z: 0, kind: 'splash', map: 'kestrel', mine: false, colour: '#ff0000', now: 2 + i });
  ok(`marks: never more than ${MK.MARK_MAX}`, m.list.length === MK.MARK_MAX);
  const mk = m.list[m.list.length - 1];
  ok('marks: solid, then fading, then gone', MK.CrashMarks.alpha(mk, mk.t0 + 10) === 1 && MK.CrashMarks.alpha(mk, mk.t0 + MK.MARK_LIFE - MK.MARK_FADE / 2) > 0.4 && MK.CrashMarks.alpha(mk, mk.t0 + MK.MARK_LIFE - MK.MARK_FADE / 2) < 0.6 && MK.CrashMarks.alpha(mk, mk.t0 + MK.MARK_LIFE + 1) === 0);
  m.prune(mk.t0 + MK.MARK_LIFE + 1);
  ok('marks: pruned when they have faded', m.list.length === 0);

  // Drawing, on a pretend canvas that counts.
  const calls = { fill: 0, save: 0, restore: 0 };
  const ctx = new Proxy({}, {
    get: (t, k) => {
      if (k in t) return t[k];
      if (k === 'fill') return () => calls.fill++;
      if (k === 'save') return () => calls.save++;
      if (k === 'restore') return () => calls.restore++;
      return () => {};
    },
    set: (t, k, v) => ((t[k] = v), true),
  });
  const d = new MK.CrashMarks();
  d.add({ x: 100, z: 100, kind: 'cartwheel', map: 'kestrel', mine: true, now: 0 }); // on the map
  d.add({ x: 1900, z: 0, kind: 'splash', map: 'kestrel', mine: true, now: 0 }); // off the 4 km circle
  d.add({ x: -300, z: 0, kind: 'splash', map: 'harrier', mine: true, now: 0 }); // other map
  const n = MK.drawCrashMarks(ctx, d, { x: 0, z: 0 }, 4000, 190, 5, 'kestrel', d.list[0]);
  ok('marks: only the ones on this map and inside the circle are drawn', n === 1, `${n} drawn`);
  ok('marks: drawing leaves the canvas as it found it', calls.save === calls.restore && ctx.globalAlpha === 1);
}

/* ---- 5. happenings ----------------------------------------------------- */
{
  const got = [];
  const off = H.onHappening((e) => got.push(e));
  H.onHappening(() => {
    throw new Error('a careless listener');
  });
  const warn = console.warn;
  console.warn = () => {};
  H.emitHappening({ type: 'crash', kind: 'bonk', vehicle: 'plane', x: 1, z: 2, map: 'kestrel' });
  H.emitHappening({ type: 'crash', kind: 'bonk', vehicle: 'plane', x: 1, z: 2, map: 'kestrel' });
  console.warn = warn;
  ok('happenings: a listener hears every one, with a time on it', got.length === 2 && Number.isFinite(got[0].t));
  ok('happenings: a listener that throws is dropped, the others still hear', got.length === 2);
  off();
  H.emitHappening({ type: 'disaster', id: 'tornado', x: 0, z: 0 });
  ok('happenings: …and one that stops listening stops hearing', got.length === 2);
  ok('happenings: the last few are kept for somebody who joins late', H.recentHappenings().length >= 3);
  const bad = [
    null,
    'crash',
    { type: 'crash', kind: 'explode', x: 0, z: 0 },
    { type: 'crash', kind: 'bonk', x: NaN, z: 0 },
    { type: 'crash', kind: 'bonk', x: 1e9, z: 0 },
    { type: 'disaster', id: '<script>', x: 0, z: 0 },
    { type: 'disaster', id: 'tornado', x: '5', z: 0 },
    { type: 'hello', x: 0, z: 0 },
  ];
  ok('happenings: junk is refused', bad.every((e) => H.cleanHappening(e) === null));
  const clean = H.cleanHappening({ type: 'crash', kind: 'splash', vehicle: 'rocket', x: 5, z: 6, map: 'kestrel', name: 'x', extra: 'y' });
  ok('happenings: a good one comes back clean — nothing extra rides along', clean && clean.vehicle === 'plane' && !('name' in clean) && !('extra' in clean));
  const d1 = H.cleanHappening({ type: 'disaster', id: 'tornado', x: 1, z: 2, summoned: 'yes' });
  const d2 = H.cleanHappening({ type: 'disaster', id: 'tornado', x: 1, z: 2, summoned: true });
  ok('happenings: "summoned" is true only when it says true', d1 && d1.summoned === false && d2 && d2.summoned === true);
  let received = null;
  H.setHappeningReceiver('crash', (sim, e, from) => ((received = { e, from }), true));
  ok('happenings: receiveHappening hands a clean one to the receiver', H.receiveHappening({}, { type: 'crash', kind: 'bonk', x: 1, z: 1 }, { name: 'Brave Otter' }) && received.e.kind === 'bonk' && received.from.name === 'Brave Otter');
  ok('happenings: …and junk never reaches it', !H.receiveHappening({}, { type: 'crash', kind: 'nope', x: 1, z: 1 }));
  H.setSummonPoint({ x: 10, z: 20 });
  const p1 = H.takeSummonPoint();
  const p2 = H.takeSummonPoint();
  ok('happenings: the summon point is taken once', p1 && p1.x === 10 && p2 === null);
}

/* ---- 6. the wildfire disaster ----------------------------------------- */
{
  const before = DIS.NATURAL_EVENTS.length;
  const WD = await import(new URL('features/wildfire-disaster.js', root));
  ok('wildfire: registered as a natural disaster', !!DIS.findEvent('wildfire') && DIS.NATURAL_EVENTS.length === before + 1);
  ok('wildfire: selectable — armed before departure and in the pause menu', DIS.SELECTABLE_EVENTS.some((e) => e.id === 'wildfire'));
  ok('wildfire: the randomiser can roll it, on every map', DIS.poolForMap({ features: {} }).some((e) => e.id === 'wildfire') && DIS.poolForMap({ features: { volcano: [{}] } }).some((e) => e.id === 'wildfire'));
  ok('wildfire: never registered twice', DIS.registerNaturalEvent(WD.WILDFIRE_EVENT) === false && DIS.NATURAL_EVENTS.filter((e) => e.id === 'wildfire').length === 1);
  const ev = DIS.findEvent('wildfire');
  ok('wildfire: explained in one line', typeof ev.hint === 'string' && ev.hint.length > 20 && ev.hint.length < 110 && /water/i.test(ev.hint), ev.hint);
  ev.apply({ mode: 'mission', hud: { notify() {} } });
  ok('wildfire: never in a mission — it says so instead', !ev.lit && /Free Flight/.test(ev.warn), ev.warn);
  ok('wildfire: a hidden event is never selectable', DIS.registerNaturalEvent({ id: 'testHidden', hidden: true, apply() {} }) && !DIS.SELECTABLE_EVENTS.some((e) => e.id === 'testHidden'));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

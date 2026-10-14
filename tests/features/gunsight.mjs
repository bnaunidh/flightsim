/**
 * Node checks for the gunsight, the lock key and "meteors need guns"
 * (src/features/gunsight.js, ./gunsight/rules.js, meteor.js, game/extra/meteor.js).
 *
 *   node tests/features/gunsight.mjs
 *
 * The owner, on the heat-seekers: "make the crosshair better and have a
 * lockon" and "you can only shoot metores if u have a plane with guns or
 * smth". What this proves, headless:
 *
 *   1. THE KEY. The lock key is one action in the one registry (ctx
 *      ['plane'], group 'Weapons', Home) and nothing else, in any game,
 *      defaults to it.
 *   2. WHO HAS GUNS. Exactly the military jets (the same six that carry
 *      heat-seekers), nobody else, never a helicopter; one rule that the
 *      zapper, the sight and the heat-seekers share.
 *   3. THE LEAD. Where the nose must point is the exact intercept: flown
 *      forward in time, a pellet (which inherits the shooter's velocity)
 *      meets the target to within a metre, for a hundred random shooters,
 *      targets and guns. Range ticks light up in step.
 *   4. THE LOCK. The key cycles the targets in front, nearest the nose
 *      first, past the last it lets go; a shot-down target is dropped.
 *   5. WHAT IS LOCKABLE. Every kind of body the game has goes through the
 *      one filter: drones and practice drones yes, meteors yes (in a plane
 *      with guns, never the giant), another player only with PvP on;
 *      civilian traffic, airliners, Air Force One, the rescue aeroplanes
 *      never — a thousand of them dead ahead of the nose are not offered.
 *   6. METEORS NEED GUNS. In an aeroplane without them the zapper does
 *      nothing and says "You need a plane with guns to shoot meteors."; the
 *      zap missions give you an aeroplane that has them; Rock Dodger and the
 *      photo run are as they were.
 *
 * Exits non-zero if anything fails.
 */

if (typeof globalThis.window === 'undefined') {
  const mem = new Map();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) },
  });
}
function fakeEl() {
  const kids = new Map();
  const el = {
    style: {},
    children: [],
    hidden: false,
    className: '',
    textContent: '',
    innerHTML: '',
    classList: { toggle() {}, add() {}, remove() {}, contains: () => false },
    getContext: () => new Proxy({}, { get: () => () => ({ addColorStop() {}, data: new Uint8ClampedArray(4) }) }),
    width: 0,
    height: 0,
    addEventListener() {},
    setAttribute() {},
    setPointerCapture() {},
    appendChild(c) { el.children.push(c); return c; },
    insertBefore(c) { el.children.push(c); return c; },
    querySelector(sel) { if (!kids.has(sel)) kids.set(sel, fakeEl()); return kids.get(sel); },
    querySelectorAll: () => [],
    getBoundingClientRect: () => ({ left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 }),
  };
  return el;
}
globalThis.document = { createElement: () => fakeEl(), body: fakeEl(), head: fakeEl(), getElementById: () => null, documentElement: fakeEl() };

const root = new URL('../../', import.meta.url);
const imp = (p) => import(new URL(p, root).href);

const results = [];
function ok(name, pass, detail = '') {
  results.push({ name, pass: !!pass, detail: String(detail) });
  return !!pass;
}

const THREE = await imp('src/vendor/three.module.js');
const T = await imp('src/world/terrain.js');
T.applyMap('kestrel');
await imp('src/features/index.js');
const Input = await imp('src/flight/input.js');
const { AIRCRAFT, getAircraft } = await imp('src/aircraft/types.js');
const G = await imp('src/features/gunsight/rules.js');
const GS = await imp('src/features/gunsight.js');
const HSK = await imp('src/features/heatseek.js');
const MET = await imp('src/features/meteor.js');
const MIS = await imp('src/game/extra/meteor.js');
const Sky = await imp('src/features/sky.js');
const PVP = await imp('src/features/pvp.js');
const PR = await imp('src/features/pvp/rules.js');
const { isMilitary } = await imp('src/features/carrier/who.js');
const { extensions } = await imp('src/game/extensions.js');

let seed = 20261012;
const rng = () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
};
const between = (a, b) => a + rng() * (b - a);

/* ---------------------------------------------------------------- 1. the key -- */
{
  const A = Input.ACTIONS;
  const k = A.lockOn;
  ok('lockOn is an action: ctx ["plane"], group "Weapons", default Home', !!k && JSON.stringify(k.ctx) === '["plane"]' && k.group === 'Weapons' && k.default.length === 1 && k.default[0] === 'Home', JSON.stringify(k));
  const sharing = Object.entries(A).filter(([id, a]) => id !== 'lockOn' && a.default.includes('Home')).map(([id]) => id);
  ok('no other action in any game defaults to the lock key', sharing.length === 0, sharing.join(', ') || 'Home is nobody else\'s');
  const clashes = Input.findConflicts(Input.defaultBindings());
  ok('no two default keys clash anywhere in the registry (the lock key, the fire key and the flares key included)', Object.keys(clashes).length === 0, JSON.stringify(clashes).slice(0, 200));
  ok('the lock key is in the aeroplane\'s Weapons group next to fire and flares', Input.groupedActions('plane').some((g) => g.id === 'Weapons' && ['fireMissile', 'flares', 'lockOn'].every((id) => g.items.some((i) => i.key === id))));
  ok('...and a helicopter\'s key list does not have it (no guns there)', !('lockOn' in Input.actionsFor('heli')));
  ok('the key is not one the hand-written key code uses (a plug-in key goes through isKey)', extensions().some((e) => e.id === 'gunsight' && typeof e.key === 'function'));
}

/* --------------------------------------------------------- 2. who has guns -- */
{
  const want = new Set(['vanguard', 'osprey', 'nightjar', 'f22', 'f35b', 'fa18']);
  const got = AIRCRAFT.filter((t) => G.hasGuns(t, 'flight')).map((t) => t.id);
  ok('exactly the six military jets have guns', got.length === want.size && got.every((id) => want.has(id)), got.join(', '));
  const never = AIRCRAFT.filter((t) => /airliner|trainer|tourer|helicopter|racer/i.test(`${t.class}`) || ['massimo', 'tpose', 'harrier'].includes(t.id)).filter((t) => !want.has(t.id));
  ok('no airliner, trainer, tourer, helicopter, Air Massimo or T-Pose Harrison has any', never.length >= 8 && never.every((t) => !G.hasGuns(t, 'flight')), never.map((t) => t.id).join(', '));
  ok('it is the heat-seekers\' own rule: the same list, type for type', AIRCRAFT.every((t) => G.hasGuns(t, 'flight') === HSK.carriesMissiles({ aircraftType: t, game: t.id === 'harrier' ? 'heli' : 'flight' })));
  ok('a military jet in the helicopter game has none', AIRCRAFT.filter((t) => isMilitary(t)).every((t) => !G.hasGuns(t, 'heli')));
  ok('a designer can mark a special type `guns: true` (a meteor hunter) and `guns: false`', G.hasGuns({ id: 'hunter', class: 'Tourer', guns: true }, 'flight') && !G.hasGuns({ id: 'x', class: 'Fighter', guns: false }, 'flight') && !G.hasGuns({ id: 'hunter', guns: true }, 'heli'));
  ok('no type is missing: nothing and null have none', !G.hasGuns(null) && !G.hasGuns(undefined) && !G.hasGuns({}));
  // The zapper asks the same rule about the aeroplane being flown.
  const mk = (id, game = 'flight') => ({ aircraft: {}, aircraftType: getAircraft(id), game });
  ok('the zapper\'s gunsOn(): the Osprey yes; the Courier, a trainer, an airliner no', MET.gunsOn(mk('osprey')) && !MET.gunsOn(mk('courier')) && !MET.gunsOn(mk('skylark')) && !MET.gunsOn(mk('b747')) && !MET.gunsOn(mk('tempest')),
    ['osprey', 'courier', 'skylark', 'b747', 'tempest'].map((id) => `${id} ${MET.gunsOn(mk(id))}`).join(', '));
  ok('...and no helicopter, no matter what', !MET.gunsOn(mk('harrier', 'heli')) && !MET.gunsOn(mk('f22', 'heli')));
}

/* --------------------------------------------------------- the numbers agree -- */
{
  ok('the pellet gun is the PvP gun: speed, life, reach', G.GUNS.pellet.speed === PVP.PELLET_SPEED && G.GUNS.pellet.life === PVP.PELLET_LIFE && G.GUNS.pellet.range === PR.RANGE_M, `${PVP.PELLET_SPEED}/${PVP.PELLET_LIFE}/${PR.RANGE_M}`);
  const { readFileSync } = await import('node:fs');
  const afo = readFileSync(new URL('src/features/events/afo-combat.js', root), 'utf8');
  const m = /const PELLET_SPEED = (\d+);/.exec(afo);
  const life = /class Pellet \{[\s\S]*?this\.life = ([\d.]+);/.exec(afo);
  ok('the escort\'s gun is the one in afo-combat.js (340 m/s, 1.1 s)', m && Number(m[1]) === G.GUNS.afo.speed && life && Number(life[1]) === G.GUNS.afo.life, `${m && m[1]} / ${life && life[1]}`);
  const met = readFileSync(new URL('src/features/meteor.js', root), 'utf8');
  const zr = /const ZAP_RANGE = (\d+);/.exec(met);
  ok('the zapper\'s reach is meteor.js\'s ZAP_RANGE', zr && Number(zr[1]) === G.GUNS.zap.range, zr && zr[1]);
  ok('what a candidate is shot with: players and practice drones the pellet, Air Force One\'s drones the escort\'s gun, meteors the zapper',
    G.gunFor({ kind: 'player' }).id === 'pellet' && G.gunFor({ kind: 'body', ref: { practice: true } }).id === 'pellet' && G.gunFor({ kind: 'body', ref: { practice: false } }).id === 'afo' && G.gunFor({ kind: 'meteor' }).id === 'zap');
}

/* ------------------------------------------------------------ 3. the lead -- */
{
  // A target dead ahead, standing still: the nose points straight at it.
  const still = G.leadAim({ pos: { x: 0, y: 500, z: 0 }, vel: { x: 0, y: 0, z: 0 } }, { pos: { x: 0, y: 500, z: -400 }, vel: { x: 0, y: 0, z: 0 } }, G.GUNS.pellet);
  ok('a target standing still dead ahead: no lead at all', still.ok && Math.abs(still.dir.z + 1) < 1e-9 && Math.abs(still.t - 400 / 430) < 1e-9, JSON.stringify(still.dir));
  // A target crossing left to right at 60 m/s, 400 m ahead, from a stationary shooter: the lead is to its right.
  const cross = G.leadAim({ pos: { x: 0, y: 500, z: 0 }, vel: { x: 0, y: 0, z: 0 } }, { pos: { x: 0, y: 500, z: -400 }, vel: { x: 60, y: 0, z: 0 } }, G.GUNS.pellet);
  const offDeg = (Math.atan2(cross.dir.x, -cross.dir.z) * 180) / Math.PI;
  ok('a target crossing right at 60 m/s, 400 m ahead: aim to its right, about 7 degrees (60 * 0.95 s / 400 m)', cross.ok && offDeg > 6 && offDeg < 8.5, `${offDeg.toFixed(2)} degrees, t ${cross.t.toFixed(3)} s`);
  // Faster target: more lead. Farther: more lead.
  const fast = G.leadAim({ pos: { x: 0, y: 500, z: 0 }, vel: { x: 0, y: 0, z: 0 } }, { pos: { x: 0, y: 500, z: -400 }, vel: { x: 120, y: 0, z: 0 } }, G.GUNS.pellet);
  const far = G.leadAim({ pos: { x: 0, y: 500, z: 0 }, vel: { x: 0, y: 0, z: 0 } }, { pos: { x: 0, y: 500, z: -800 }, vel: { x: 60, y: 0, z: 0 } }, G.GUNS.pellet);
  const ang = (a) => (Math.atan2(a.dir.x, -a.dir.z) * 180) / Math.PI;
  ok('twice as fast: more lead', ang(fast) > ang(cross) * 1.7, `${ang(fast).toFixed(2)} vs ${ang(cross).toFixed(2)}`);
  ok('twice as far: more lead (the burst takes longer)', ang(far) > ang(cross) * 0.95 && far.t > cross.t * 1.8, `${ang(far).toFixed(2)} vs ${ang(cross).toFixed(2)}`);
  // The shooter's own velocity is in the pellet: a shooter flying sideways at 100 m/s at a standing target must aim off to the other side.
  const drift = G.leadAim({ pos: { x: 0, y: 500, z: 0 }, vel: { x: 100, y: 0, z: 0 } }, { pos: { x: 0, y: 500, z: -400 }, vel: { x: 0, y: 0, z: 0 } }, G.GUNS.pellet);
  ok('a shooter sliding right at a standing target aims LEFT of it (the pellet carries the slide)', drift.ok && drift.dir.x < -0.05, `dir.x ${drift.dir.x.toFixed(3)}`);
  // A target running away faster than the pellet flies can never be hit.
  const gone = G.leadAim({ pos: { x: 0, y: 0, z: 0 }, vel: { x: 0, y: 0, z: 0 } }, { pos: { x: 0, y: 0, z: -500 }, vel: { x: 0, y: 0, z: -600 } }, G.GUNS.pellet);
  ok('a target pulling away faster than the pellet: no solution, and it says so', !gone.ok && !gone.inRange);

  // The real proof: fly the pellet. Random shooters, targets and guns; the pellet must meet the target.
  let worst = 0;
  let solved = 0;
  for (let i = 0; i < 400; i++) {
    const gun = [G.GUNS.pellet, G.GUNS.afo, G.GUNS.zap][i % 3];
    const sh = { pos: { x: between(-500, 500), y: between(100, 900), z: between(-500, 500) }, vel: { x: between(-150, 150), y: between(-20, 20), z: between(-150, 150) } };
    const dir = { x: between(-1, 1), y: between(-0.4, 0.4), z: between(-1, 1) };
    const dl = Math.hypot(dir.x, dir.y, dir.z);
    const range = between(80, 2500);
    const tg = { pos: { x: sh.pos.x + (dir.x / dl) * range, y: sh.pos.y + (dir.y / dl) * range, z: sh.pos.z + (dir.z / dl) * range }, vel: { x: between(-120, 120), y: between(-30, 30), z: between(-120, 120) } };
    const lead = G.leadAim(sh, tg, gun);
    if (!lead.ok) continue;
    solved++;
    // The pellet: the shooter's velocity plus `speed` along the aim.
    const pv = { x: sh.vel.x + lead.dir.x * gun.speed, y: sh.vel.y + lead.dir.y * gun.speed, z: sh.vel.z + lead.dir.z * gun.speed };
    const pel = { x: sh.pos.x + pv.x * lead.t, y: sh.pos.y + pv.y * lead.t, z: sh.pos.z + pv.z * lead.t };
    const tgt = { x: tg.pos.x + tg.vel.x * lead.t, y: tg.pos.y + tg.vel.y * lead.t, z: tg.pos.z + tg.vel.z * lead.t };
    worst = Math.max(worst, Math.hypot(pel.x - tgt.x, pel.y - tgt.y, pel.z - tgt.z));
  }
  ok('400 random shots (shooter and target both moving, three guns): the pellet meets the target to under a millimetre', solved > 300 && worst < 1e-3, `${solved} solved, worst miss ${worst.toExponential(2)} m`);
  ok('...and `point` is where the target is when it arrives', (() => {
    const l = G.leadAim({ pos: { x: 0, y: 0, z: 0 }, vel: { x: 30, y: 0, z: 0 } }, { pos: { x: 100, y: 50, z: -300 }, vel: { x: -20, y: 5, z: 10 } }, G.GUNS.pellet);
    return Math.abs(l.point.x - (100 - 20 * l.t)) < 1e-9 && Math.abs(l.point.z - (-300 + 10 * l.t)) < 1e-9;
  })());
  // Inside the reach.
  const near = G.leadAim({ pos: { x: 0, y: 0, z: 0 }, vel: { x: 0, y: 0, z: 0 } }, { pos: { x: 0, y: 0, z: -500 }, vel: { x: 0, y: 0, z: 0 } }, G.GUNS.pellet);
  const out = G.leadAim({ pos: { x: 0, y: 0, z: 0 }, vel: { x: 0, y: 0, z: 0 } }, { pos: { x: 0, y: 0, z: -1500 }, vel: { x: 0, y: 0, z: 0 } }, G.GUNS.pellet);
  ok('inside the pellet\'s 700 m reach: in range; at 1.5 km: a solution, but out of reach (the pipper goes dim)', near.inRange && out.ok && !out.inRange);

  // The range ticks.
  const n = G.SIGHT.ticks;
  ok('twelve range ticks round the ring', n === 12);
  ok('inside the gun\'s reach every tick is lit; at 1.5x the reach fewer; at 3x none',
    G.rangeTicks(300, G.GUNS.pellet).lit === n && G.rangeTicks(700, G.GUNS.pellet).lit === n && G.rangeTicks(700, G.GUNS.pellet).inRange
    && G.rangeTicks(1050, G.GUNS.pellet).lit > 0 && G.rangeTicks(1050, G.GUNS.pellet).lit < n && G.rangeTicks(2100, G.GUNS.pellet).lit === 0,
    [300, 700, 1050, 1400, 2100].map((r) => `${r}m:${G.rangeTicks(r, G.GUNS.pellet).lit}`).join(' '));
  let mono = true;
  let prev = 99;
  for (let r = 0; r <= 3000; r += 25) {
    const lit = G.rangeTicks(r, G.GUNS.pellet).lit;
    if (lit > prev) mono = false;
    prev = lit;
  }
  ok('the ticks only ever go down as the target goes further out', mono);
  ok('"all lit" means in range and nothing else does', [100, 700, 701, 900, 1400].every((r) => (G.rangeTicks(r, G.GUNS.pellet).lit === n) === (r <= 700)));
  ok('the same ruler for the zapper\'s 3.5 km: all twelve at 3000 m', G.rangeTicks(3000, G.GUNS.zap).lit === n && G.rangeTicks(5000, G.GUNS.zap).lit < n);
  ok('range text: 420 m, 2.3 km', G.rangeText(423) === '420 m' && G.rangeText(2340) === '2.3 km');
}

/* ----------------------------------------------------------------- 4. the lock -- */
{
  const origin = { x: 0, y: 500, z: 0 };
  const fwd = { x: 0, y: 0, z: -1 };
  const at = (deg, range, id) => ({ id: id || `t${deg}`, pos: { x: Math.sin((deg * Math.PI) / 180) * range, y: 500, z: -Math.cos((deg * Math.PI) / 180) * range } });
  const a = at(5, 1500);
  const b = at(-20, 900);
  const c = at(40, 2000);
  const behind = at(150, 800, 'behind');
  const tooFar = at(0, 9000, 'far');
  const d = new G.Designation();
  ok('nothing locked to begin with', !d.active);
  ok('a press with the sky empty ahead: nothing to lock, nothing to let go of', d.cycle(origin, fwd, [behind, tooFar]).action === 'none' && !d.active);
  const r1 = d.cycle(origin, fwd, [c, b, a, behind, tooFar]);
  ok('the first press takes the one nearest the nose', r1.action === 'set' && r1.cand === a && d.id === a.id, r1.cand && r1.cand.id);
  const r2 = d.cycle(origin, fwd, [c, b, a, behind, tooFar]);
  ok('the next press takes the next nearest the nose', r2.action === 'next' && r2.cand === b, r2.cand && r2.cand.id);
  const r3 = d.cycle(origin, fwd, [c, b, a, behind, tooFar]);
  ok('...and the next', r3.action === 'next' && r3.cand === c);
  const r4 = d.cycle(origin, fwd, [c, b, a, behind, tooFar]);
  ok('past the last it lets go', r4.action === 'cleared' && !d.active && d.target === null);
  ok('one behind the nose, or too far, is never offered', ![r1, r2, r3].some((r) => r.cand === behind || r.cand === tooFar));
  // The one held goes off to the side: a press goes to the one nearest the nose instead.
  d.cycle(origin, fwd, [a]);
  const side = d.cycle(origin, fwd, [at(120, 500, 't5'), b]);
  ok('if the held one is behind you now, a press picks the best in front', side.action === 'next' && side.cand === b);
  // Keeping it honest.
  const d2 = new G.Designation();
  d2.cycle(origin, fwd, [a]);
  ok('it follows the target by id even when the list is rebuilt every frame', d2.update(0.03, origin, [{ id: a.id, pos: a.pos }]) === false && d2.active);
  let letGo = false;
  for (let i = 0; i < 60 && !letGo; i++) letGo = d2.update(0.05, origin, []);
  ok('a target that was shot down is let go after a moment', letGo && !d2.active);
  const d3 = new G.Designation();
  d3.cycle(origin, fwd, [a]);
  let farGo = false;
  for (let i = 0; i < 60 && !farGo; i++) farGo = d3.update(0.05, origin, [{ id: a.id, pos: { x: 0, y: 500, z: -20000 } }]);
  ok('a target flown far away is let go', farGo);
  // Off the screen: the arrow.
  const up = G.ringMark(0, -50, 100);
  const right = G.ringMark(50, 0, 100);
  const down = G.ringMark(0, 30, 100);
  const left = G.ringMark(-9, 0, 100);
  ok('the arrow: up for above, right for right, down for below/behind, left for left, always on the ring',
    Math.abs(up.x) < 1e-9 && Math.abs(up.y + 100) < 1e-9 && up.ang === 0
    && Math.abs(right.x - 100) < 1e-9 && Math.abs(right.ang - Math.PI / 2) < 1e-9
    && Math.abs(down.y - 100) < 1e-9 && Math.abs(Math.abs(down.ang) - Math.PI) < 1e-9
    && Math.abs(left.x + 100) < 1e-9 && Math.abs(left.ang + Math.PI / 2) < 1e-9
    && [up, right, down, left].every((m) => Math.abs(Math.hypot(m.x, m.y) - 100) < 1e-9));
  ok('a target exactly behind the middle points up, and never NaN', Number.isFinite(G.ringMark(0, 0, 100).ang) && G.ringMark(0, 0, 100).y === -100);
}

/* ------------------------------------------- 5. what is lockable, for the gun -- */
{
  const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
  const fwd = V3(0, 0, -1);
  const me = V3(0, 600, 0);
  const sim = (id, meteors = null) => ({ aircraftType: getAircraft(id), game: 'flight', aircraft: { pos: me, quat: new THREE.Quaternion(), vel: V3(0, 0, -100) }, meteors });
  const reg = (spec) => Sky.registerBody({ pos: V3(0, 600, -800), vel: V3(0, 0, -30), radius: 10, ...spec });
  const bodies = [
    reg({ id: 'g-drone', kind: 'enemy', name: 'a drone', small: true, crew: 0 }),
    reg({ id: 'g-practice', kind: 'enemy', name: 'a target drone', small: true, crew: 0, practice: true }),
    reg({ id: 'g-civil', kind: 'traffic', name: 'Island 47', crew: 1 }),
    reg({ id: 'g-afo', kind: 'npc', name: 'Air Force One', crew: 2, typeId: 'b747' }),
    reg({ id: 'g-rescue', kind: 'friend', name: 'Rescue One', crew: 1 }),
    reg({ id: 'g-pursuer', kind: 'enemy', name: 'Ironhead One', crew: 1 }),
    reg({ id: 'g-airliner', kind: 'enemy', small: true, crew: 0, typeId: 'a320', name: 'x' }),
  ];
  const met = (uid, giant = false) => ({ id: `meteor:${uid}`, uid, pos: V3(100 * uid, 700, -1200), vel: V3(0, -50, 0), radius: 3, kind: 'meteor', name: 'a meteor', ref: { giant } });
  // A real meteor handle, put into play, for the real filter (the giant is not offered).
  const fakeSimForMet = { scene: new THREE.Scene(), camera: new THREE.PerspectiveCamera(65, 16 / 9, 0.1, 60000), state: 'flying', aircraft: { pos: me, quat: new THREE.Quaternion(), vel: V3(0, 0, -100), heading: 0, agl: 600, crashed: false }, aircraftType: getAircraft('osprey'), game: 'flight', hud: { notify() {} }, settings: {} };
  MET.begin(fakeSimForMet, { mode: 'shower' }, null);
  const rock = MET.API.spawn({ target: V3(0, 700, -2000), az: 0, dive: 20, speed: 200, T: 6, radius: 3, size: 1.5 });
  const giant = MET.API.spawn({ target: V3(500, 700, -3000), az: 0, dive: 10, speed: 40, T: 6, radius: 40, size: 5, giant: true });
  const listed = MET.API.targets([]);
  ok('the meteor handle offers the live rocks to lock on, and not the giant (far too big to zap)', listed.length === 1 && listed[0].uid === rock.uid && listed.every((m) => m.kind === 'meteor' && m.pos && m.vel), listed.map((m) => m.id).join(','));
  ok('...each with an id that stays with the rock, not the slot it sits in', /^meteor:\d+$/.test(listed[0].id) && listed[0].uid !== giant.uid);
  const withMet = { ...sim('osprey'), meteors: MET.API };
  const ids = GS.gunsight.gunTargets(withMet).map((c) => c.id).sort();
  ok('a plane with guns can lock: the drone, the practice drone, the meteor — and nothing else in the sky',
    JSON.stringify(ids) === JSON.stringify(['g-drone', 'g-practice', `meteor:${rock.uid}`].sort()), ids.join(', '));
  const civilSim = { ...sim('courier'), meteors: MET.API };
  const civilIds = GS.gunsight.gunTargets(civilSim).map((c) => c.id);
  ok('the meteors are a gun target only for a plane that has guns (a Courier is not offered any)', !civilIds.some((i) => /^meteor/.test(i)));
  ok('civilian traffic, an airliner, Air Force One, the rescue aeroplane and a manned pursuer are never offered, though they sit dead ahead',
    !ids.some((i) => ['g-civil', 'g-afo', 'g-rescue', 'g-pursuer', 'g-airliner'].includes(i)), ids.join(', '));
  // Through the real lock key's cycle too.
  const d = new G.Designation();
  const seen = new Set();
  for (let i = 0; i < 6; i++) {
    const r = d.cycle({ x: 0, y: 600, z: 0 }, { x: 0, y: 0, z: -1 }, GS.gunsight.gunTargets(withMet));
    if (r.cand) seen.add(r.cand.id);
  }
  ok('cycling the lock key six times never lands on a civilian or Air Force One', [...seen].every((i) => !['g-civil', 'g-afo', 'g-rescue', 'g-pursuer', 'g-airliner'].includes(i)) && seen.size === 3, [...seen].join(', '));
  // A thousand civilians in the seeker.
  const crowd = [];
  for (let i = 0; i < 300; i++) crowd.push(Sky.registerBody({ id: `crowd-${i}`, kind: ['traffic', 'npc', 'friend'][i % 3], name: ['Island 47', 'Air Force One', 'Rescue One'][i % 3], pos: V3(between(-300, 300), 600 + between(-100, 100), -between(300, 3000)), vel: V3(0, 0, -50), radius: 12, crew: 1 }));
  const withCrowd = GS.gunsight.gunTargets(withMet).map((c) => c.id);
  ok('three hundred civilians, Air Force Ones and rescue aeroplanes in front of the nose add nothing to what can be locked', withCrowd.length === ids.length, `${withCrowd.length} vs ${ids.length}`);
  for (const b of [...bodies, ...crowd]) Sky.unregisterBody(b);

  // PvP: a player is lockable only with PvP on for me.
  const players = [{ id: 3, me: false, name: 'Brave Otter', pos: { x: 0, y: 600, z: -900 }, vel: { x: 0, y: 0, z: -80 }, visible: true, pvp: true, ghost: false, radius: 6 }];
  const keep = { on: HSK.net.on, players: HSK.net.players, row: HSK.net.row };
  HSK.net.players = () => players;
  HSK.net.row = () => ({ on: true, arming: false, down: false, shield: false });
  HSK.net.on = () => false;
  const off = GS.gunsight.gunTargets(sim('courier')).map((c) => c.id);
  HSK.net.on = () => true;
  const on = GS.gunsight.gunTargets(sim('courier')).map((c) => c.id);
  ok('PvP off: you cannot lock a player; PvP on: you can, in any aeroplane', !off.includes('p3') && on.includes('p3'), `off ${off.join(',')} | on ${on.join(',')}`);
  ok('...and a Courier with PvP on has a gun aboard (the pellets), with PvP off it has none', (() => {
    const s = { ...sim('courier'), state: 'flying', aircraft: { ...sim('courier').aircraft, crashed: false, onGround: false } };
    const withP = GS.gunAboard(s);
    HSK.net.on = () => false;
    const without = GS.gunAboard(s);
    return withP && !without;
  })());
  Object.assign(HSK.net, keep);
}

/* ------------------------------------------------- 6. meteors need guns -- */
{
  const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
  const notes = [];
  const mkSim = (id, game = 'flight') => ({
    scene: new THREE.Scene(),
    camera: new THREE.PerspectiveCamera(65, 16 / 9, 0.1, 60000),
    state: 'flying',
    game,
    aircraft: { pos: V3(0, 650, 0), quat: new THREE.Quaternion(), vel: V3(0, 0, -90), heading: 0, agl: 650, crashed: false },
    aircraftType: getAircraft(id),
    hud: { notify: (t) => notes.push(t) },
    settings: {},
  });
  // A Courier in meteor mode.
  const civil = mkSim('courier');
  MET.begin(civil, { mode: 'shower' }, null);
  const rock = MET.API.spawn({ target: V3(0, 660, -900), az: 0, dive: 5, speed: 90, T: 4, radius: 3, size: 1.5 });
  MET.updateMeteorMode(civil, 0.05);
  notes.length = 0;
  const z0 = MET.API.stats.zapped;
  const res = MET.zap(civil);
  ok('a Courier cannot zap: nothing is popped and the rock is still there', res === false && MET.API.stats.zapped === z0 && rock.active);
  ok('...and it says, calmly: "You need a plane with guns to shoot meteors."', notes.length === 1 && notes[0] === 'You need a plane with guns to shoot meteors.' && MET.NO_GUNS_HINT === notes[0], JSON.stringify(notes));
  const res2 = MET.zap(civil);
  ok('...once, not on every press (no scolding)', notes.length === 1 && res2 === false);
  // Every way a pilot can reach for it: the key and the API are the same function.
  ok('the Z key and the ZAP button go through the same zap() (so the same answer)', (() => {
    const ext = extensions().find((e) => e.id === 'meteor');
    const n0 = MET.API.stats.zapped;
    ext.key(civil, 'KeyZ', true, {});
    MET.API.zap();
    return MET.API.stats.zapped === n0 && rock.active;
  })());
  MET.end();

  // A heli, a trainer and an airliner: the same.
  for (const [id, game] of [['skylark', 'flight'], ['b747', 'flight'], ['harrier', 'heli']]) {
    const s = mkSim(id, game);
    MET.begin(s, { mode: 'shower' }, null);
    const r = MET.API.spawn({ target: V3(0, 660, -900), az: 0, dive: 5, speed: 90, T: 4, radius: 3, size: 1.5 });
    MET.updateMeteorMode(s, 0.05);
    ok(`${id}: cannot zap`, MET.zap(s) === false && r.active && MET.API.stats.zapped === 0);
    MET.end();
  }

  // An Osprey: the same rock, in front of the nose, is a zap target (its beam, the bang and the tally are the real thing in the browser test).
  const jet = mkSim('osprey');
  MET.begin(jet, { mode: 'shower' }, null);
  const rock2 = MET.API.spawn({ target: V3(0, 660, -900), az: 0, dive: 5, speed: 90, T: 4, radius: 3, size: 1.5 });
  MET.updateMeteorMode(jet, 0.05);
  notes.length = 0;
  let threw = null;
  let zapped = false;
  try {
    zapped = MET.zap(jet);
  } catch (e) {
    threw = e;
  }
  // The bang needs the world's explosion meshes; a missing mesh in this stub must not be mistaken for "cannot zap".
  ok('an Osprey is not stopped by the gun rule: no hint, and either the rock pops or only the stub world is missing', !notes.includes(MET.NO_GUNS_HINT) && (zapped === true || !rock2.active || (threw && /undefined|null/.test(String(threw.message)))), threw ? threw.message : `zapped ${zapped}`);
  MET.end();

  // The missions.
  const mets = MIS.MISSIONS.filter((m) => m.category === 'meteor');
  ok('four meteor missions', mets.length === 4, mets.map((m) => m.id).join(', '));
  const bad = [];
  for (const m of mets) {
    const zapMode = !!MET.MODES[m.meteor.mode].zapper;
    const t = getAircraft(m.aircraft);
    if (zapMode && !G.hasGuns(t, 'flight')) bad.push(`${m.id} (${m.aircraft})`);
  }
  ok('every mission that is about zapping gives you an aeroplane with guns', bad.length === 0, bad.join(', ') || mets.map((m) => `${m.id}:${m.aircraft}`).join(' '));
  const byId = Object.fromEntries(mets.map((m) => [m.id, m]));
  ok('Meteor Shower and Guard the Town are zap missions, flown in a jet', MET.MODES.shower.zapper && MET.MODES.town.zapper && G.hasGuns(getAircraft(byId['meteor-shower'].aircraft)) && G.hasGuns(getAircraft(byId['meteor-town'].aircraft)),
    `${byId['meteor-shower'].aircraft}, ${byId['meteor-town'].aircraft}`);
  ok('Rock Dodger stays as it was: the Courier, no zapper (you dodge, you do not shoot)', byId['meteor-dodge'].aircraft === 'courier' && !MET.MODES.dodge.zapper);
  ok('the photo run stays in the Tempest and has no zapper to be denied', byId['meteor-photo'].aircraft === 'tempest' && !MET.MODES.photo.zapper);
  ok('a jet needs more speed than a Courier: the zap missions start it well above its stall', ['meteor-shower', 'meteor-town'].every((id) => {
    const sp = byId[id].spawn.speed;
    return sp >= 80;
  }), ['meteor-shower', 'meteor-town'].map((id) => byId[id].spawn.speed).join(', '));
  ok('the missions say so in their words (so a player is not surprised)', /guns/i.test(byId['meteor-shower'].blurb + byId['meteor-shower'].reward) && /guns/i.test(byId['meteor-town'].blurb));
}

/* ---------------------------------------------------------------- the screen -- */
{
  const { readFileSync, readdirSync } = await import('node:fs');
  const files = ['src/features/gunsight.js', 'src/features/gunsight/hud.js', 'src/features/gunsight/rules.js'].map((f) => [f, readFileSync(new URL(f, root), 'utf8')]);
  const code = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const noise = files.filter(([, s]) => /AudioContext|\.play\(|new Audio|speechSynthesis|sim\.speak|sfx\(|blip\(/.test(code(s))).map(([f]) => f);
  ok('no sound anywhere in the gunsight: no audio context, no clip, no speech, no lock tone', noise.length === 0, noise.join(', ') || `${files.length} files read`);
  const rnd = files.filter(([, s]) => /Math\.random/.test(code(s))).map(([f]) => f);
  ok('nothing in it flickers: no random brightness anywhere', rnd.length === 0, rnd.join(', ') || 'none');
  const anim = files.filter(([, s]) => /@keyframes|animation:|setInterval|requestAnimationFrame/.test(code(s))).map(([f]) => f);
  ok('nothing in it blinks or animates on its own (the box and the pipper change colour and stay put)', anim.length === 0, anim.join(', ') || 'steady');
  const sw = readFileSync(new URL('sw.js', root), 'utf8');
  ok('all three gunsight files are in the offline cache', files.every(([f]) => sw.includes(`'${f}'`)));
}

const failed = results.filter((r) => !r.pass);
for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? `\n      ${r.detail}` : ''}`);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);

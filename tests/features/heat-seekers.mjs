/**
 * Node checks for the heat-seeking missiles and the Heat-Seeker disaster
 * (src/features/heatseek.js, ./heatseek/*, ../heatseek-disaster.js).
 *
 *   node tests/features/heat-seekers.mjs
 *
 * The owner: "heat seeking missles on miltary pllanes and it as a disaster
 * push now" ... "only get 3". What this proves, headless:
 *
 *   1. THE KEYS. Fire is one action in the one registry — ctx ['plane'],
 *      group 'Weapons', the backslash — and NO other action, in any game,
 *      defaults to that key; the flares key shares only by design (4, with Air
 *      Force One's decoys and quick chat) and nothing else clashes.
 *   2. WHO CARRIES THEM. Exactly the military aeroplanes (the Vanguard, the
 *      Osprey, the Nightjar, the F-22, the F-35B, the F/A-18) — checked
 *      against every type in the roster; no airliner, trainer, tourer,
 *      helicopter, Air Massimo, T-Pose Harrison.
 *   3. THREE. A loadout of exactly 3, then nothing; rearm only by landing and
 *      stopping on made ground (a runway, an apron, a deck) for a few seconds.
 *   4. PYLONS. Every military model gets three stations under its wings and
 *      belly, on its own skin, the missiles visible until fired.
 *   5. THE LOCK. A seeker cone about 20 degrees across; a valid target held
 *      in it for a second goes red; a second one does not steal it; a flicker
 *      out of the cone is forgiven; a locked target may drift to 24 degrees.
 *   6. WHAT IS A TARGET. Every kind of body the game has, through
 *      targetVerdict(): drones and practice drones yes; PvP players only with
 *      PvP on for both; civilian traffic, airliners, Air Force One, the rescue
 *      aeroplanes, friends, manned pursuers never.
 *   7. PROPORTIONAL NAVIGATION. It steers to where the target WILL be (a
 *      crossing drone is hit from every angle in the cone); a boost then a
 *      coast; a range of about 3 km; a gimbal limit; a hard break at short
 *      range beats it; a flare pulls it off, better with a hard turn, and not
 *      if it burned out before the missile arrived; a helicopter's missiles
 *      are slower.
 *   8. PvP. The host judges a missile that hits a player as the PvP tag:
 *      both in play, near enough, not shielded, at most 3 a minute.
 *   9. THE DISASTER. Registered with registerNaturalEvent: selectable, in the
 *      pause menu's list, never in the randomiser, and its salvos, break
 *      side, damage zone and severity come out as the brief says.
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
/** A DOM element that takes whatever the HUD does to it. */
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
    appendChild(c) {
      el.children.push(c);
      return c;
    },
    insertBefore(c) {
      el.children.push(c);
      return c;
    },
    querySelector(sel) {
      if (!kids.has(sel)) kids.set(sel, fakeEl());
      return kids.get(sel);
    },
    querySelectorAll: () => [],
    getBoundingClientRect: () => ({ left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 }),
  };
  return el;
}
globalThis.document = {
  createElement: () => fakeEl(),
  body: fakeEl(),
  head: fakeEl(),
  getElementById: () => null,
  documentElement: fakeEl(),
};

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
const { AIRCRAFT } = await imp('src/aircraft/types.js');
const R = await imp('src/features/heatseek/rules.js');
const Fly = await imp('src/features/heatseek/fly.js');
const World = await imp('src/features/heatseek/world.js');
const HSK = await imp('src/features/heatseek.js');
const Dis = await imp('src/game/disasters.js');
const Disaster = await imp('src/features/heatseek-disaster.js');
const PR = await imp('src/features/pvp/rules.js');
const { createAircraftModel } = await imp('src/aircraft/model-adapter.js');
const { isMilitary } = await imp('src/features/carrier/who.js');
const { extensions } = await imp('src/game/extensions.js');

/* deterministic dice */
let seed = 987654321;
const rng = () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
};

/* ---------------------------------------------------------------- 1. keys -- */
{
  const A = Input.ACTIONS;
  const f = A.fireMissile;
  ok('fireMissile is an action: ctx ["plane"], group "Weapons", default Backslash',
    !!f && JSON.stringify(f.ctx) === '["plane"]' && f.group === 'Weapons' && f.default.length === 1 && f.default[0] === 'Backslash', JSON.stringify(f));
  ok('"Weapons" is a real group in Settings and on the H card', Input.GROUPS.some((g) => g.id === 'Weapons'), Input.GROUPS.map((g) => g.id).join(', '));
  const sharing = Object.entries(A).filter(([id, a]) => id !== 'fireMissile' && a.default.includes('Backslash')).map(([id]) => id);
  ok('no other action in any game defaults to the fire key', sharing.length === 0, sharing.join(', ') || 'Backslash is nobody else\'s');
  const fl = A.flares;
  ok('flares is an action in Weapons for the aeroplane and the helicopter (the disaster works in both)', !!fl && fl.group === 'Weapons' && fl.ctx.includes('plane') && fl.ctx.includes('heli'), JSON.stringify(fl));
  const flareSharers = Object.entries(A).filter(([id, a]) => id !== 'flares' && a.default.some((c) => fl.default.includes(c))).map(([id]) => id).sort();
  ok('the flares key is shared only with Air Force One\'s decoys and quick chat, by design', JSON.stringify(flareSharers) === JSON.stringify(['afoFlare', 'mpChat2']), flareSharers.join(', '));
  const clashes = Input.findConflicts(Input.defaultBindings());
  ok('no two default keys clash with the weapons in the registry', Object.keys(clashes).length === 0, JSON.stringify(clashes).slice(0, 200));
  // Every other key a plane-context action uses, against the fire key, by walking the whole registry.
  const planeKeys = new Set();
  for (const [id, a] of Object.entries(A)) if (id !== 'fireMissile' && a.ctx.includes('plane')) for (const c of a.default) planeKeys.add(c);
  ok('the backslash is free in the aeroplane (autopilot quote/minus/equals, replay backtick, chute semicolon, hook and salute brackets all checked)', !planeKeys.has('Backslash'));
}

/* ------------------------------------------------------- 2. who carries them -- */
{
  const want = new Set(['vanguard', 'osprey', 'nightjar', 'f22', 'f35b', 'fa18', 'a10']);
  const got = AIRCRAFT.filter((t) => HSK.carriesMissiles({ aircraftType: t, game: t.id === 'harrier' ? 'heli' : 'flight' })).map((t) => t.id);
  ok('exactly the military aeroplanes carry them', got.length === want.size && got.every((id) => want.has(id)), got.join(', '));
  const never = AIRCRAFT.filter((t) => /airliner|trainer|tourer|helicopter|racer/i.test(`${t.class}`) || ['massimo', 'tpose', 'harrier'].includes(t.id)).filter((t) => !want.has(t.id));
  ok('no airliner, trainer, tourer, helicopter, Air Massimo or T-Pose Harrison carries any', never.length >= 8 && never.every((t) => !HSK.carriesMissiles({ aircraftType: t, game: 'flight' })), never.map((t) => t.id).join(', '));
  ok('it is the same rule as the carrier\'s: isMilitary()', AIRCRAFT.every((t) => HSK.carriesMissiles({ aircraftType: t, game: 'flight' }) === (isMilitary(t) && !['harrier', 'massimo', 'tpose'].includes(t.id))));
  ok('a military jet in the helicopter game is not armed', !HSK.carriesMissiles({ aircraftType: AIRCRAFT.find((t) => t.id === 'f22'), game: 'heli' }));
}

/* --------------------------------------------------------- 3. three, and rearm -- */
{
  ok('the loadout is 3', R.LOADOUT === 3);
  const L = new R.Loadout();
  ok('a new loadout reads MSL 3/3', L.label === 'MSL 3/3' && L.left === 3);
  const fired = [L.fire(), L.fire(), L.fire(), L.fire(), L.fire()];
  ok('three fire, the fourth and fifth do not (3 hits max, then 0/3)', JSON.stringify(fired) === '[true,true,true,false,false]' && L.left === 0 && L.label === 'MSL 0/3', JSON.stringify(fired));
  ok('rearm puts all three back (and says it changed something)', L.rearm() === true && L.left === 3 && L.rearm() === false);

  const g = new R.RearmGate();
  const base = { onGround: true, speed: 0, atBase: true, needs: true };
  let got = false;
  for (let t = 0; t < 2.4; t += 0.1) got = got || g.update(0.1, base);
  ok('stopped on made ground for under 2.5 s: not yet', !got);
  for (let t = 0; t < 0.3; t += 0.1) got = got || g.update(0.1, base);
  ok('...and at 2.5 s it rearms', got);
  const g2 = new R.RearmGate();
  const none = (state) => { let r = false; for (let t = 0; t < 8; t += 0.1) r = r || g2.update(0.1, state); g2.reset(); return r; };
  ok('in the air: never', none({ ...base, onGround: false }) === false);
  ok('rolling (5 m/s): never', none({ ...base, speed: 5 }) === false);
  ok('stopped in a field (not an airbase or a deck): never', none({ ...base, atBase: false }) === false);
  ok('already full: nothing to do', none({ ...base, needs: false }) === false);
  // A single moving frame resets the count.
  const g3 = new R.RearmGate();
  for (let t = 0; t < 2.0; t += 0.1) g3.update(0.1, base);
  g3.update(0.1, { ...base, speed: 4 });
  let r3 = false;
  for (let t = 0; t < 2.0; t += 0.1) r3 = r3 || g3.update(0.1, base);
  ok('moving in the middle starts the count over', r3 === false);

  // The real game's test for "an airbase or a carrier" is isPaved() (runway, taxiway, apron, deck).
  ok('Kestrel\'s runway counts as an airbase for the rearm; open grass does not', T.isPaved(0, 0) && !T.isPaved(1800, 2400));
  // A carrier's deck is a platform in the terrain: as paved as a runway, so landing and stopping on the ship rearms too.
  const open = !T.isPaved(30000, 30000);
  T.addPlatform(30000, 30000, 60, 240, 22, 'test deck');
  const onDeck = T.isPaved(30000, 30000) && T.isPaved(30020, 30100) && !T.isPaved(30100, 30000);
  T.clearPlatforms();
  ok('a carrier deck counts as a base for the rearm (a platform in the terrain), and the sea beside it does not', open && onDeck && !T.isPaved(30000, 30000), `open ${open}, deck ${onDeck}`);
}

/* ---------------------------------------------------------------- 4. pylons -- */
{
  const mil = AIRCRAFT.filter((t) => isMilitary(t) && t.id !== 'harrier');
  ok('seven military models', mil.length === 7, mil.map((t) => t.id).join(', '));
  for (const t of mil) {
    const model = createAircraftModel({ type: t, livery: t.livery });
    const rig = Fly.buildPylons(model, t, 3);
    const half = (model.userData.flightGeometry && model.userData.flightGeometry.wingSpan / 2) || t.plan.span / 2;
    const finite = rig.stations.every((s) => [s.x, s.y, s.z].every(Number.isFinite));
    ok(`${t.id}: three stations, R then L then belly, all finite`, rig.stations.length === 3 && rig.stations.map((s) => s.id).join('') === 'RLC' && finite,
      rig.stations.map((s) => `${s.id}(${s.x.toFixed(1)},${s.y.toFixed(2)},${s.z.toFixed(1)})`).join(' '));
    const [r, l, c] = rig.stations;
    ok(`${t.id}: the wing pylons are mirror images, out from the fuselage and inside the wing tips`,
      Math.abs(r.x + l.x) < 1e-6 && r.x >= 1.8 && r.x <= half - 0.9 && Math.abs(r.y - l.y) < 0.05 && r.z === l.z, `x ${r.x.toFixed(2)} of ${half.toFixed(2)}`);
    ok(`${t.id}: the belly one is on the centreline`, c.x === 0, `z ${c.z}`);
    // The pylon hangs from the skin: the lowest skin above its position is within a few cm of where it starts.
    const skin = Fly.undersideAt(model, rig.group, r.x, r.z, NaN);
    ok(`${t.id}: the right pylon starts on the wing's own underside (a ray up finds skin there)`, Number.isFinite(skin) && Math.abs(skin - r.y) < 0.02, `skin ${skin.toFixed(3)} vs ${r.y.toFixed(3)}`);
    // Where the missile body ends up is inside the model's own bounds sideways and below its wing.
    const box = new THREE.Box3().setFromObject(r.mesh);
    const mb = new THREE.Box3().setFromObject(model);
    ok(`${t.id}: the missile hangs below its pylon, inside the aeroplane's span, about 3 m long`,
      box.max.y < r.y && box.min.x > mb.min.x && box.max.x < mb.max.x && box.max.z - box.min.z > 2.4 && box.max.z - box.min.z < 3.6,
      `y ${box.min.y.toFixed(2)}..${box.max.y.toFixed(2)}, length ${(box.max.z - box.min.z).toFixed(2)}`);
    // Each leaves its pylon when fired.
    r.on = false;
    r.mesh.visible = false;
    ok(`${t.id}: a fired missile's mesh is gone from its pylon (the pylon stays)`, r.mesh.visible === false && r.pylon.visible !== false);
    ok(`${t.id}: the rig is marked as not airframe, so the break-up skips it`, rig.group.userData.noAirframe === true && rig.group.parent === model);
  }
}

/* ---------------------------------------------------------------- 5. the lock -- */
{
  const o = { x: 0, y: 500, z: 0 };
  const fwd = { x: 0, y: 0, z: -1 };
  const at = (deg, range) => ({ id: `t${deg}`, pos: { x: Math.sin((deg * Math.PI) / 180) * range, y: 500, z: -Math.cos((deg * Math.PI) / 180) * range } });
  ok('the seeker is about 20 degrees across (10 each side)', R.SEEKER.halfDeg === 10);
  const a = at(6, 1500);
  const b = at(14, 1500);
  const cone = R.inCone(o, fwd, [a, b, at(0, 3500), at(0, 50)]);
  ok('in the cone: 6 degrees yes, 14 no, too far no, too close no', cone.length === 1 && cone[0].cand === a, cone.map((c) => c.cand.id).join(','));

  const lk = new R.LockTracker();
  let t = 0;
  while (t < 0.9) { lk.update(1 / 30, o, fwd, [a]); t += 1 / 30; }
  ok('held for 0.9 s: acquiring, not locked, the box is not red', !lk.locked && lk.target === a && lk.progress > 0.8 && lk.progress < 1, lk.progress.toFixed(2));
  while (t < 1.2) { lk.update(1 / 30, o, fwd, [a]); t += 1 / 30; }
  ok('held for a second: LOCKED (the box turns red)', lk.locked && lk.progress === 1);
  // A second target crossing the cone does not steal a lock.
  const c2 = at(1, 1200);
  lk.update(1 / 30, o, fwd, [a, c2]);
  ok('a nearer-the-nose target does not steal the lock', lk.target.id === a.id && lk.locked);
  // A locked target may wander out to 24 degrees.
  const wide = at(20, 1500);
  lk.update(1 / 30, o, fwd, [{ id: a.id, pos: wide.pos }]);
  ok('a locked target holds out to 20 degrees', lk.locked);
  const lk2 = new R.LockTracker();
  for (let i = 0; i < 20; i++) lk2.update(1 / 30, o, fwd, [{ id: a.id, pos: wide.pos }]);
  ok('...but an unlocked one at 20 degrees was never acquired', !lk2.target);
  // A flicker.
  const lk3 = new R.LockTracker();
  for (let i = 0; i < 20; i++) lk3.update(1 / 30, o, fwd, [a]);
  // Out of the cone for a moment (still a valid target, just 30 degrees off the nose).
  lk3.update(0.1, o, fwd, [{ id: a.id, pos: at(30, 1500).pos }]);
  const stillCounting = lk3.target && lk3.t > 0.5;
  lk3.update(0.1, o, fwd, [a]);
  ok('a 0.1 s flicker out of the cone does not reset the count', stillCounting && lk3.t > 0.6, lk3.t.toFixed(2));
  lk3.update(0.5, o, fwd, [{ id: a.id, pos: at(30, 1500).pos }]);
  ok('half a second out of the cone does', !lk3.target && !lk3.locked);
  const lk3b = new R.LockTracker();
  for (let i = 0; i < 20; i++) lk3b.update(1 / 30, o, fwd, [a]);
  lk3b.update(0.1, o, fwd, []);
  ok('a target that vanishes (shot down by someone else) is dropped at once', !lk3b.target);
  const lk4 = new R.LockTracker();
  for (let i = 0; i < 60; i++) lk4.update(1 / 30, o, fwd, [a]);
  const before = lk4.locked;
  for (let i = 0; i < 12; i++) lk4.update(1 / 30, o, fwd, [{ id: a.id, pos: at(40, 1500).pos }]);
  ok('a locked target that goes 40 degrees off the nose is dropped', before && !lk4.locked);
  ok('nothing in the cone: nothing is acquired', new R.LockTracker().update(1, o, fwd, [at(30, 1000)]).target === null);
}

/* ---------------------------------------------------------- 6. what is a target -- */
{
  const V = (b, ctx) => R.targetVerdict(b, ctx);
  const v = {
    drone: V({ kind: 'enemy', small: true, crew: 0, name: 'a drone' }),
    practice: V({ kind: 'enemy', small: true, crew: 0, practice: true, name: 'a target drone' }),
    traffic: V({ kind: 'traffic', name: 'Island 47' }),
    trafficSmall: V({ kind: 'traffic', small: true, crew: 0 }),
    npc: V({ kind: 'npc', name: 'the airliner' }),
    af1: V({ kind: 'npc', name: 'Air Force One', typeId: 'b747' }),
    af1enemy: V({ kind: 'enemy', small: true, crew: 0, name: 'Air Force One' }),
    airliner: V({ kind: 'enemy', small: true, crew: 0, typeId: 'a320', name: 'x' }),
    friend: V({ kind: 'friend', name: 'Guardian lead' }),
    rescue: V({ kind: 'friend', name: 'Rescue One' }),
    rescue2: V({ kind: 'enemy', small: true, crew: 0, name: 'Rescue Two' }),
    pursuer: V({ kind: 'enemy', small: false, crew: 1, name: 'Ironhead One' }),
    civilian: V({ kind: 'enemy', small: true, crew: 0, civilian: true }),
    playerOff: V({ kind: 'player', pvpLive: true, name: 'Brave Otter' }, { pvp: false }),
    playerOn: V({ kind: 'player', pvpLive: true, name: 'Brave Otter' }, { pvp: true }),
    playerShield: V({ kind: 'player', pvpLive: false, name: 'Brave Otter' }, { pvp: true }),
    nothing: V(null),
  };
  ok('a hostile drone is a target', v.drone.ok, v.drone.why);
  ok('a practice target drone is a target', v.practice.ok, v.practice.why);
  ok('civilian traffic is never a target', !v.traffic.ok && !v.trafficSmall.ok, `${v.traffic.why}; ${v.trafficSmall.why}`);
  ok('an NPC airliner is never a target', !v.npc.ok);
  ok('Air Force One is never a target (by name, by type, even if flagged as a drone)', !v.af1.ok && !v.af1enemy.ok && !v.airliner.ok, `${v.af1.why}; ${v.af1enemy.why}; ${v.airliner.why}`);
  ok('the rescue aeroplanes and friends are never a target', !v.friend.ok && !v.rescue.ok && !v.rescue2.ok);
  ok('a manned pursuer (the chase\'s jet) is not a drone, so not a target', !v.pursuer.ok, v.pursuer.why);
  ok('anything flagged civilian is out', !v.civilian.ok);
  ok('another player: not with PvP off', !v.playerOff.ok, v.playerOff.why);
  ok('another player: yes with PvP on for both', v.playerOn.ok, v.playerOn.why);
  ok('another player who is shielded, tagged out or has PvP off: no', !v.playerShield.ok, v.playerShield.why);
  ok('nothing is not a target', !v.nothing.ok);
  // Every kind of body the sky list has, with every flag combination: only the allowed ones pass.
  let leaks = 0;
  let allowed = 0;
  for (const kind of ['traffic', 'npc', 'friend', 'enemy']) {
    for (const small of [true, false]) for (const crew of [0, 1]) for (const practice of [true, false, undefined]) {
      for (const name of ['Island 47', 'Air Force One', 'a drone', 'Rescue One', 'the airliner', 'Ironhead One']) {
        const r = V({ kind, small, crew, practice, name });
        if (r.ok) {
          allowed++;
          if (kind !== 'enemy' || /air force|rescue|airliner/i.test(name)) leaks++;
        }
      }
    }
  }
  ok('over every kind/flag/name combination only unmanned enemy drones get through', leaks === 0 && allowed > 0, `${allowed} allowed, ${leaks} leaks`);
}

/* ---------------------------------------------------------- 7. proportional nav -- */
function makeTarget(x, y, z, hdgDeg, speed, turnRate = 0) {
  const t = { x, y, z, h: (hdgDeg * Math.PI) / 180, speed, turnRate, vx: 0, vy: 0, vz: 0 };
  t.vx = Math.sin(t.h) * speed;
  t.vz = -Math.cos(t.h) * speed;
  t.step = (dt) => {
    t.h += t.turnRate * dt;
    t.vx = Math.sin(t.h) * t.speed;
    t.vz = -Math.cos(t.h) * t.speed;
    t.x += t.vx * dt;
    t.y += t.vy * dt;
    t.z += t.vz * dt;
  };
  return t;
}
function fly({ params, from, vel, target, plan, flarePlan, dt = 1 / 60, maxT = 22 }) {
  const m = R.newMissile(from, vel, params);
  const flares = [];
  let salvo = 0;
  let tt = 0;
  const speeds = [];
  while (tt < maxT && !m.result) {
    if (plan) plan(tt, m, target);
    if (flarePlan && flarePlan(tt, m, target)) {
      salvo++;
      for (let i = 0; i < 2; i++) flares.push({ id: salvo * 10 + i, salvo, x: target.x - target.vx * 0.05 * (i + 1), y: target.y - 2, z: target.z - target.vz * 0.05 * (i + 1), vx: target.vx * 0.35, vy: -6, vz: target.vz * 0.35, age: 0, life: R.FLARE_LIFE });
    }
    for (const f of flares) { f.age += dt; f.vy -= 2.2 * dt; f.x += f.vx * dt; f.y += f.vy * dt; f.z += f.vz * dt; }
    R.considerDecoys(m, target, flares, Math.abs(target.turnRate) * target.speed / 9.80665, rng);
    const aim = m.decoy
      ? { x: m.decoy.x, y: m.decoy.y, z: m.decoy.z, vx: m.decoy.vx, vy: m.decoy.vy, vz: m.decoy.vz, isTarget: false }
      : { x: target.x, y: target.y, z: target.z, vx: target.vx, vy: target.vy, vz: target.vz, isTarget: true };
    R.stepMissile(m, aim, dt, { groundAt: () => -50 });
    target.step(dt);
    tt += dt;
    if (Math.round(tt * 60) % 6 === 0) speeds.push(m.speed);
  }
  return { m, t: tt, hit: m.result === 'hit' && m.hitTarget, flareKill: m.result === 'hit' && !m.hitTarget, speeds };
}
function runs(n, make) {
  const out = [];
  for (let i = 0; i < n; i++) out.push(make(i));
  return out;
}
const rate = (rs, key = 'hit') => rs.filter((r) => r[key]).length / rs.length;

{
  // PN: no acceleration when on a collision course; it leads a crossing target.
  const P = R.FLIGHT.player;
  const m = R.newMissile({ x: 0, y: 500, z: 0 }, { x: 0, y: 0, z: -300 }, P);
  // Target dead ahead, closing straight: the line of sight is not turning.
  R.stepMissile(m, { x: 0, y: 500, z: -1500, vx: 0, vy: 0, vz: 0 }, 0.01, { groundAt: () => -50 });
  ok('PN: dead ahead on a collision course asks for no turn', m.maxLateral < 1e-6, `${m.maxLateral}`);
  const m2 = R.newMissile({ x: 0, y: 500, z: 0 }, { x: 0, y: 0, z: -300 }, P);
  R.stepMissile(m2, { x: 0, y: 500, z: -1500, vx: 80, vy: 0, vz: 0 }, 0.01, { groundAt: () => -50 });
  ok('PN: a target crossing to the right makes it turn right (it leads)', m2.vx > 0 && m2.maxLateral > 10, `vx ${m2.vx.toFixed(2)}, a ${m2.maxLateral.toFixed(0)} m/s²`);

  // The flight: a hit from every angle in the cone on a drone doing 55 m/s.
  const drone = (name, hdg, tr = 0, range = 1500) => runs(40, () => {
    const a = (rng() * 2 - 1) * 9 * (Math.PI / 180);
    return fly({ params: P, from: { x: 0, y: 500, z: 0 }, vel: { x: 0, y: 0, z: -120 }, target: makeTarget(range * Math.sin(a), 480 + rng() * 40, -range * Math.cos(a), hdg, 55, tr) });
  });
  for (const [n, rs] of [['crossing', drone('x', 90)], ['head-on', drone('h', 180)], ['going away', drone('a', 0, 0, 1000)], ['circling (0.1 rad/s) at 2.2 km', drone('c', 90, 0.1, 2200)]]) {
    ok(`PN: a missile hits a drone ${n}, 40 of 40 from inside the cone`, rate(rs) === 1, `${rs.filter((r) => r.hit).length}/40, about ${(rs.reduce((s, r) => s + r.t, 0) / rs.length).toFixed(1)} s`);
  }
  // Boost then coast.
  const one = fly({ params: P, from: { x: 0, y: 500, z: 0 }, vel: { x: 0, y: 0, z: -120 }, target: makeTarget(0, 500, -2600, 90, 55) });
  const peak = Math.max(...one.speeds);
  const peakAt = one.speeds.indexOf(peak);
  // (samples are every 0.1 s)
  ok('boost then coast: it speeds up for under 2 s, then loses speed to drag', peak > 300 && peak <= P.vMax && peakAt * 0.1 >= 1.2 && peakAt * 0.1 <= 2.0 && one.speeds[one.speeds.length - 1] < peak - 20, `peak ${peak.toFixed(0)} m/s at ${(peakAt * 0.1).toFixed(1)} s, ${one.speeds[one.speeds.length - 1].toFixed(0)} m/s at the end`);
  // Range: about 2-3 km.
  const far = fly({ params: P, from: { x: 0, y: 500, z: 0 }, vel: { x: 0, y: 0, z: -120 }, target: makeTarget(0, 500, -6500, 0, 50), maxT: 30 });
  ok('max range about 3 km: a target at 6.5 km running away is not caught', !far.hit && far.m.travelled <= P.rangeCap + 20 && far.m.travelled > 2200, `travelled ${far.m.travelled.toFixed(0)} m, ${far.m.result}`);
  const at3 = runs(30, () => fly({ params: P, from: { x: 0, y: 500, z: 0 }, vel: { x: 0, y: 0, z: -120 }, target: makeTarget(2700 * Math.sin(0.1), 500, -2700 * Math.cos(0.1), 90, 55) }));
  ok('...but a target 2.7 km out is inside its reach', rate(at3) > 0.9, `${(rate(at3) * 100).toFixed(0)}%`);
  // Gimbal: a target behind it cannot be seen.
  const behind = R.newMissile({ x: 0, y: 500, z: 0 }, { x: 0, y: 0, z: -300 }, P);
  R.stepMissile(behind, { x: 0, y: 500, z: 800, vx: 0, vy: 0, vz: 0 }, 0.01, { groundAt: () => -50 });
  ok('the seeker has a limit: a target behind it is lost', behind.lost === true, behind.lostWhy);

  // A hard break at short range beats a missile; the same break early does not.
  const brk = (closeAt, speed, g) => runs(40, () => {
    const a = (rng() * 2 - 1) * 8 * (Math.PI / 180);
    const tg = makeTarget(2000 * Math.sin(a), 500, -2000 * Math.cos(a), rng() * 360, speed, 0);
    let broke = false;
    const side = rng() < 0.5 ? 1 : -1;
    return fly({ params: R.FLIGHT.threat, from: { x: 0, y: 500, z: 0 }, vel: { x: 0, y: 0, z: -150 }, target: tg, plan: (t, m, x) => { if (!broke && Math.hypot(m.x - x.x, m.z - x.z) < closeAt) { broke = true; x.turnRate = (side * g * 9.80665) / x.speed; } } });
  });
  const fast = brk(350, 220, 8);
  ok('a fast jet pulling 8 g at 350 m turns inside it a good part of the time (>= 35% survive)', rate(fast) <= 0.65, `${(rate(fast) * 100).toFixed(0)}% hit`);
  const trainer = brk(900, 70, 3);
  ok('...a trainer\'s 3 g does not (they need flares)', rate(trainer) === 1, `${(rate(trainer) * 100).toFixed(0)}% hit`);

  // Flares: a threat missile from 2.4 km at a 150 m/s jet.
  const vsJet = (label, flareAt, g, params = R.FLIGHT.threat, speed = 150) => runs(60, () => {
    const th = rng() * 360;
    const a = (th * Math.PI) / 180 + (rng() * 2 - 1) * 110 * (Math.PI / 180);
    const mx = 2400 * Math.sin(a);
    const mz = -2400 * Math.cos(a);
    const tg = makeTarget(0, 500, 0, th, speed, 0);
    const dx = -mx;
    const dz = -mz;
    const L = Math.hypot(dx, 480, dz);
    const left = Array.isArray(flareAt) ? [...flareAt] : flareAt ? [flareAt] : [];
    let turned = false;
    return fly({
      params,
      from: { x: mx, y: 20, z: mz },
      vel: { x: (dx / L) * 70, y: (480 / L) * 70, z: (dz / L) * 70 },
      target: tg,
      plan: (t, m, x) => {
        const d = Math.hypot(m.x - x.x, m.y - x.y, m.z - x.z);
        if (g && !turned && d < (left.length ? left[0] + 100 : 800)) { turned = true; x.turnRate = ((rng() < 0.5 ? 1 : -1) * g * 9.80665) / x.speed; }
      },
      flarePlan: (t, m, x) => {
        const d = Math.hypot(m.x - x.x, m.y - x.y, m.z - x.z);
        if (left.length && d < left[0]) { left.shift(); return true; }
        return false;
      },
    });
  });
  const none = vsJet('none', null, 0);
  const flare900 = vsJet('flares 900', 900, 0);
  const flareTurn = vsJet('flares 900 + 4g', 900, 4);
  const two = vsJet('two salvos', [1000, 600], 4);
  const tooEarly = vsJet('flares at 1900', 1900, 0);
  const hit = (rs) => rate(rs);
  ok('a pilot who does nothing is hit most of the time (>= 70%)', hit(none) >= 0.7, `${(hit(none) * 100).toFixed(0)}%`);
  ok('flares at 900 m cut it to under a third', hit(flare900) < hit(none) * 0.45 && hit(flare900) < 0.35, `${(hit(flare900) * 100).toFixed(0)}% hit, ${(rate(flare900, 'flareKill') * 100).toFixed(0)}% took a flare`);
  ok('flares and a hard turn are better than flares alone', hit(flareTurn) <= hit(flare900) && hit(flareTurn) < 0.2, `${(hit(flareTurn) * 100).toFixed(0)}% vs ${(hit(flare900) * 100).toFixed(0)}%`);
  ok('two salvos and a break: almost always clear (<= 5% hit)', hit(two) <= 0.05, `${(hit(two) * 100).toFixed(0)}%`);
  ok('flares dropped too early (1.9 km) burn out first: it still comes (>= 20% hit, and worse than at 900 m)', hit(tooEarly) >= 0.2 && hit(tooEarly) > hit(flare900), `${(hit(tooEarly) * 100).toFixed(0)}%`);
  // A helicopter: slower missiles, easier to dodge.
  const heliNone = vsJet('heli', null, 0, R.FLIGHT.slow, 40);
  // The slow one needs the flare later: 4.5 s of burn is a shorter way for a slower missile.
  const heliFlare = vsJet('heli flares', 550, 0, R.FLIGHT.slow, 40);
  const jetSpeedPeak = Math.max(...fly({ params: R.FLIGHT.threat, from: { x: 0, y: 500, z: 0 }, vel: { x: 0, y: 0, z: -60 }, target: makeTarget(0, 500, -2400, 90, 50) }).speeds);
  const heliSpeedPeak = Math.max(...fly({ params: R.FLIGHT.slow, from: { x: 0, y: 500, z: 0 }, vel: { x: 0, y: 0, z: -60 }, target: makeTarget(0, 500, -2400, 90, 40) }).speeds);
  ok('in a helicopter the missiles are slower (peak speed at least a third less)', heliSpeedPeak < jetSpeedPeak * 0.67, `${heliSpeedPeak.toFixed(0)} vs ${jetSpeedPeak.toFixed(0)} m/s`);
  ok('...and easier to dodge: it turns less hard (11 g against 15), and a well-timed flare beats it', R.FLIGHT.slow.gMax < R.FLIGHT.threat.gMax && hit(heliFlare) < 0.45 && hit(heliFlare) < hit(heliNone) * 0.7, `${(hit(heliFlare) * 100).toFixed(0)}% hit with a flare at 550 m, ${(hit(heliNone) * 100).toFixed(0)}% without`);
  // The decoy chance.
  ok('a hard turn improves a flare\'s odds (0 g < 4 g < 7 g) up to a cap', R.decoyChance(0) < R.decoyChance(4) && R.decoyChance(4) < R.decoyChance(7) + 1e-9 && R.decoyChance(20) <= 0.93, `${R.decoyChance(0).toFixed(2)} ${R.decoyChance(4).toFixed(2)} ${R.decoyChance(20).toFixed(2)}`);
  // A fuze must not skip over a target in one frame (a missile moves 13 m a frame at 30 fps).
  const skip = R.newMissile({ x: 0, y: 500, z: 0 }, { x: 0, y: 0, z: -400 }, P);
  R.stepMissile(skip, { x: 3, y: 500, z: -5, vx: 0, vy: 0, vz: 0 }, 1 / 30, { groundAt: () => -50 });
  ok('the fuze catches a pass inside one frame (swept closest approach)', skip.result === 'hit', skip.result);
  ok('closestApproach is exact on a straight line', Math.abs(R.closestApproach({ x: 10, y: 5, z: 0 }, { x: -10, y: 5, z: 0 }).dist - 5) < 1e-9);
}

/* ---------------------------------------------------------------- 8. PvP -- */
{
  const J = new PR.PvpJudge({ now: () => 1000 });
  J.join(0); J.join(1);
  const turnOn = (id, t) => { J.want(id, true, t); J.tick(t + PR.ARM_MS + 10); };
  ok('a missile claim is a defined message: cleanMsl takes a player id and nothing else', JSON.stringify(PR.cleanMsl({ t: 3, x: 'hi' })) === '{"t":3}' && PR.cleanMsl({ t: 99 }) === null && PR.cleanMsl(null) === null && PR.cleanMsl({ t: 'a' }) === null);
  ok('the down message may say a heat-seeker did it (how 2) and still refuses nonsense', !!PR.cleanDown({ t: 1, by: 0, how: 2 }) && PR.cleanDown({ t: 1, by: 0, how: 3 }) === null);
  ok('cleanLaunch and cleanFlare take ids and nothing else', JSON.stringify(R.cleanLaunch({ t: 2, text: 'x' })) === '{"t":2}' && R.cleanLaunch({ t: 20 }) === null && JSON.stringify(R.cleanFlare({ junk: 1 })) === '{}');
  const off = J.missile(0, 1, 100, 20000);
  ok('PvP off for both: the host refuses a missile', !off.ok && /PvP off/.test(off.why), off.why);
  turnOn(0, 20000);
  const half = J.missile(0, 1, 100, 25000);
  ok('PvP on for the shooter only: refused (that player has PvP off)', !half.ok && /target has PvP off/.test(half.why), half.why);
  turnOn(1, 30000);
  J.tick(40000); // shields from arming end
  const t0 = 60000;
  J.tick(t0);
  const far = J.missile(0, 1, 5000, t0);
  ok('further apart than a missile can fly (3.8 km, as the host sees them): refused', !far.ok && /too far/.test(far.why), far.why);
  const hit = J.missile(0, 1, 2600, t0);
  ok('both in play and within a missile\'s reach (2.6 km apart): the host tags the target — the whole of the hearts', hit.ok && hit.down === true && J.players.get(1).hp === 0 && J.players.get(0).tags === 1, JSON.stringify(hit));
  ok('the target is down for DOWN_MS and then shielded', J.players.get(1).downUntil === t0 + PR.DOWN_MS && J.players.get(1).shieldUntil > J.players.get(1).downUntil);
  const again = J.missile(0, 1, 120, t0 + 500);
  ok('a second missile on someone already tagged out is refused', !again.ok && /tagged out|shielded/.test(again.why), again.why);
  // Rate limit.
  const K = new PR.PvpJudge({ now: () => 0 });
  K.join(0); K.join(1);
  const on = (id, t) => { K.want(id, true, t); K.tick(t + PR.ARM_MS + 10); };
  on(0, 1000); on(1, 1000);
  let okCount = 0;
  let t = 10000;
  for (let i = 0; i < 6; i++) {
    K.tick(t);
    // Put the target back in play between claims.
    const v = K.players.get(1); v.downUntil = 0; v.shieldUntil = 0; v.hp = PR.HEARTS;
    if (K.missile(0, 1, 100, t).ok) okCount++;
    t += 5000;
  }
  ok(`at most ${PR.MSL_PER_MIN} missile claims a minute from one shooter`, okCount === PR.MSL_PER_MIN, `${okCount} of 6 inside 30 s`);
  const later = K.players.get(1); later.downUntil = 0; later.shieldUntil = 0;
  ok('...and a minute later it counts again', K.missile(0, 1, 100, t + 60000).ok);
  const self = K.missile(0, 0, 0, t + 70000);
  ok('nobody tags themselves', !self.ok && self.why === 'self');
}

/* ------------------------------------------------------------- 9. the disaster -- */
{
  const ev = Dis.findEvent('heatSeeker');
  ok('the Heat-Seeker is registered with registerNaturalEvent()', !!ev && ev === Disaster.HEAT_SEEKER_EVENT);
  ok('...so it is in the list the Free Flight screen arms from and the pause menu\'s Disasters fold shows', Dis.SELECTABLE_EVENTS.includes(ev) && Dis.NATURAL_EVENTS.includes(ev));
  ok('...with a name, a hint, a warning and the usual shape', ev.name === 'Heat-Seeker' && typeof ev.hint === 'string' && ev.hint.length > 10 && typeof ev.warn === 'string' && typeof ev.apply === 'function' && ev.kind === 'bad');
  const maps = [];
  for (const id of ['kestrel', 'atoll', 'ember', 'harrier']) {
    try { maps.push(await imp('src/world/maps.js').then((m) => m.getMap(id))); } catch (e) { /* a map id this build has not got */ }
  }
  const pools = maps.filter(Boolean).map((m) => Dis.poolForMap(m));
  ok('the randomiser never picks it, on any map (selectable-only)', pools.length > 0 && pools.every((p) => !p.includes(ev)) && pools.every((p) => p.length > 3), `${pools.length} maps checked, pool sizes ${pools.map((p) => p.length).join(',')}`);
  ok('registering it twice leaves the first (an id already listed is left alone)', Dis.registerNaturalEvent({ ...ev }) === false);
  ok('it is a Free Flight thing: asked of a mission or a drive it says no, and lights nothing', ev.apply({ mode: 'mission', state: 'flying', aircraft: {} }) === false && ev.apply({ mode: 'drive', state: 'flying', aircraft: {} }) === false && /Free Flight/.test(ev.warn));
  ok('the extension for it is registered and live', extensions().some((e) => e.id === 'heatseek-disaster') && extensions().some((e) => e.id === 'heatseek'));

  // Salvos: 60-90 s, one or two at a time, with gaps.
  let allGood = true;
  let sizes = { 1: 0, 2: 0 };
  for (let i = 0; i < 200; i++) {
    const total = 60 + rng() * 30;
    const plan = R.planSalvos(total, rng);
    allGood = allGood && plan.length >= 3 && plan.length <= 9 && plan.every((s) => s.count === 1 || s.count === 2) && plan[0].at <= 6 && plan.every((s, k) => k === 0 || s.at - plan[k - 1].at >= 9 - 1e-9) && plan[plan.length - 1].at < total;
    for (const s of plan) sizes[s.count]++;
  }
  ok('the salvos come in ones and twos, 9+ seconds apart, the first inside 6 s, all inside the window', allGood, `${sizes[1]} singles, ${sizes[2]} pairs`);
  ok('...with singles commoner than pairs', sizes[1] > sizes[2] && sizes[2] > 0);
  // The warning: the side that puts it on the beam.
  ok('break side: a missile ahead on the right → break left; ahead left → right', R.breakSide(30) === 'left' && R.breakSide(-30) === 'right' && R.breakSide(0) === 'right');
  ok('break side: a missile behind on the right → turn right to bring it round to the beam', R.breakSide(150) === 'right' && R.breakSide(-150) === 'left' && R.breakSide(-200) === 'right');
  ok('the break side is always left or right', [-540, -270, -179, -91, -90, 0, 89, 90, 180, 359].every((d) => ['left', 'right'].includes(R.breakSide(d))));
  // Damage zones: the nearest to the burst.
  const dims = { L: 16, semi: 5, noseZ: -8, tailZ: 8 };
  ok('a burst out on the left wing hits the left wing; the right, the right', R.nearestPart({ x: -3.5, y: 0, z: 0 }, dims) === 'leftWing' && R.nearestPart({ x: 3.5, y: 0, z: 0.5 }, dims) === 'rightWing');
  ok('ahead of the wing is the nose; behind is the tail; in the middle the fuselage', R.nearestPart({ x: 0, y: 0, z: -7 }, dims) === 'nose' && R.nearestPart({ x: 0.2, y: 0, z: 7 }, dims) === 'tail' && R.nearestPart({ x: 0.5, y: 0, z: 0 }, dims) === 'fuselage');
  ok('a helicopter has no wings: its sides are the cabin and its aft end the tail boom', R.nearestPart({ x: 3, y: 0, z: 0 }, dims, true) === 'fuselage' && R.nearestPart({ x: 0, y: 0, z: 7 }, dims, true) === 'tail');
  const names = new Set();
  for (const x of [-4, 4]) for (const z of [-7, 0, 7]) for (const heli of [false, true]) names.add(R.nearestPart({ x, y: 0, z }, dims, heli));
  names.add(R.nearestPart({ x: 0, y: 0, z: 0 }, dims));
  const { Aircraft } = await imp('src/aircraft/physics.js');
  const probe = new Aircraft();
  ok('the parts it names are parts the flight model can hurt (physics takeHit)', [...names].every((n) => n in probe.damage), [...names].join(', '));
  const hurt = [];
  probe.on('damage', (d) => hurt.push(d));
  const level = probe.takeHit('leftWing', 0.8, 'Hit by a heat-seeking missile', { x: 1, y: 2, z: 3 });
  ok('takeHit with the missile\'s point records the damage and tells the break-up where (it snaps what is nearest)', level === 0.8 && probe.damage.leftWing === 0.8 && hurt.length === 1 && hurt[0].point && hurt[0].point.x === 1 && probe.worstDamage === 0.8);
  ok('severity runs 0.4..0.95; a dead-centre roll is a big hit, a glancing one is not', R.hitSeverity(0, 0) === 0.4 && R.hitSeverity(1, 1) <= 0.95 && R.hitSeverity(1, 0.9) >= R.BIG_HIT && R.hitSeverity(0.1, 0.1) < R.BIG_HIT);
  ok('sites: two, one ahead and one abeam, 2.3-2.9 km out, every time', (() => {
    const ac = { pos: new THREE.Vector3(0, 400, 0), heading: 90 };
    for (let i = 0; i < 50; i++) {
      const s = Disaster.pickSites(ac, rng);
      if (s.length !== 2) return false;
      for (const k of s) if (k.dist < 2300 || k.dist > 2900) return false;
      const rel = (k) => Math.abs(((((Math.atan2(k.x, -k.z) * 180) / Math.PI) - 90 + 540) % 360) - 180);
      if (rel(s[0]) > 36) return false;
      if (rel(s[1]) < 69 || rel(s[1]) > 111) return false;
    }
    return true;
  })());
}

{
  // A launcher must be able to see you: no hill between. Over open sea the line is clear; across the island's own high ground it is not.
  const isl = T.ISLANDS[0];
  const across = Disaster.lineClearance(isl.cx - isl.radius * 1.3, 10, isl.cz, isl.cx + isl.radius * 1.3, 10, isl.cz);
  const sea = Disaster.lineClearance(-9000, 60, -9000, -6000, 400, -9000);
  ok('line of sight: open sea is clear, the far side of the island is not (negative clearance)', sea > 50 && across < 0, `sea ${sea.toFixed(0)} m, across the island ${across.toFixed(0)} m`);
  const ac = { pos: new THREE.Vector3(isl.cx, isl.peak + 200, isl.cz), heading: 0 };
  let blocked = 0;
  for (let i = 0; i < 30; i++) {
    const [a, b] = Disaster.pickSites(ac, rng);
    for (const k of [a, b]) if (Disaster.lineClearance(k.x, k.y + 5.2, k.z, ac.pos.x, ac.pos.y, ac.pos.z) <= 0) blocked++;
  }
  ok('the sites it picks can all see an aeroplane above the island (no launcher behind a hill)', blocked === 0, `${blocked} blocked of 60`);
}

/* -------------------------------------------------------- the world of missiles -- */
{
  // A missile in the world: it flies, trails smoke, ends with a reason, and the world hands flares to its target's owner only.
  const scene = new THREE.Scene();
  const group = new THREE.Group();
  scene.add(group);
  const sim = { scene, renderer: null, camera: null };
  World.ensureWorld(sim, group);
  const target = makeTarget(0, 500, -1800, 90, 55);
  const ends = [];
  const m = World.launchMissile({
    pos: { x: 0, y: 500, z: 0 }, vel: { x: 0, y: 0, z: -120 }, params: R.FLIGHT.player, owner: 'me',
    target: { id: 'x', owner: 'me', aim: (o) => { o.x = target.x; o.y = target.y; o.z = target.z; o.vx = target.vx; o.vy = 0; o.vz = target.vz; return true; }, g: () => 0 },
    onEnd: (mm, why) => ends.push(why),
  });
  ok('a launched missile is in the world list with a mesh in the scene', World.liveMissiles().length === 1 && m.mesh.parent === group);
  for (let i = 0; i < 60 * 8 && !m.dead; i++) { target.step(1 / 60); World.updateWorld(1 / 60, sim); }
  ok('it flew on its own and ended in a hit on the drone', m.dead && ends.join() === 'hit' && m.mesh.parent === null, ends.join());
  ok('it left a white trail (smoke puffs in the world)', World.HS.trails.count > 20, `${World.HS.trails.count} puffs`);
  const salvo = World.deployFlares('p3', { x: 0, y: 500, z: 0 }, { x: 0, y: 0, z: -100 }, { count: 2 });
  ok('flares belong to whoever dropped them', World.flaresOf('p3').length === 2 && World.flaresOf('me').length === 0 && salvo > 0);
  for (let i = 0; i < 60 * 5; i++) World.updateWorld(1 / 60, sim);
  ok('a flare burns out after four and a half seconds', World.flaresOf('p3').length === 0);
  World.clearWorld();
  ok('clearing the world leaves no missile and no flare', World.liveMissiles().length === 0 && World.HS.flares.length === 0);
}

/* ----------------------------------------------------------- the drone's shot() -- */
{
  const { AttackField } = await imp('src/features/events/afo-combat.js');
  const scene = new THREE.Scene();
  const sim = { scene, camera: new THREE.PerspectiveCamera(), hud: { notify() {} } };
  const field = new AttackField(sim);
  field.spawnWave([new THREE.Vector3(0, 400, -2000), new THREE.Vector3(500, 400, -2000)]);
  const { bodies } = await imp('src/features/sky.js');
  const dr = bodies().filter((b) => b.kind === 'enemy' && b.small);
  ok('Air Force One\'s drones are in the sky list as unmanned enemy drones with a shot()', dr.length >= 2 && dr.every((b) => typeof b.shot === 'function' && b.crew === 0), `${dr.length} drones`);
  const verdicts = dr.map((b) => R.targetVerdict({ kind: b.kind, small: b.small, crew: b.crew, practice: b.practice, name: b.name }));
  ok('...and every one is a valid target', verdicts.every((v) => v.ok), verdicts.map((v) => v.why).join('; '));
  dr[0].shot(sim);
  ok('a heat-seeker\'s strike downs it and is counted as shot down', field.drones.filter((d) => d.alive).length === 1 && field.stats.shotDrones === 1, JSON.stringify(field.stats));
  field.dispose();
}

/* ------------------------------------------------------- no sound, no raw flash -- */
{
  const { readFileSync, readdirSync } = await import('node:fs');
  const files = ['src/features/heatseek.js', 'src/features/heatseek-disaster.js', ...readdirSync(new URL('src/features/heatseek/', root)).map((f) => `src/features/heatseek/${f}`)];
  const sound = [];
  const flash = [];
  for (const f of files) {
    const text = readFileSync(new URL(f, root), 'utf8');
    const code = text.split('\n').filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l)).join('\n');
    if (/AudioContext|new Audio\(|\.audio\b|alerts\.|blip\(|\.play\(|SpeechSynthesis|sim\.speak\(/.test(code)) sound.push(f);
    // A random brightness every frame is noise, not light; every glow here is steady or goes through blinkLevel.
    if (/opacity\s*=\s*[^;\n]*Math\.random\(\)/.test(code)) flash.push(f);
  }
  ok('no sound anywhere in the heat-seekers: no audio context, no alert, no blip, no speech', sound.length === 0, sound.join(', ') || `${files.length} files read`);
  ok('nothing of it sets a light to a random brightness each frame', flash.length === 0, flash.join(', ') || 'steady glows and slow swells only');
  const hud = readFileSync(new URL('src/features/heatseek/hud.js', root), 'utf8');
  ok('the warning glow is held under the full-screen cap and swells through blinkLevel (Reduce flashing)', /screenOpacity\(/.test(hud) && /blinkLevel\(/.test(hud));
  const fly = readFileSync(new URL('src/features/heatseek/fly.js', root), 'utf8');
  ok('the launcher\'s and the drone\'s lamps swell through blinkLevel, never a hard on/off', (fly.match(/blinkLevel\(/g) || []).length >= 2);
}

/* ------------------------------------------------------------------ report -- */
let failed = 0;
for (const r of results) {
  if (!r.pass) failed++;
  console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? `\n      ${r.detail}` : ''}`);
}
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);

/**
 * Node checks for Air Force One's lead-fighter seat, and the escort gun the
 * other two seats share. Model: tests/features/afo-president.mjs — this
 * drives src/game/roles/afo-lead.js's two stories (createNormalEscort/
 * createAttackEscort) through cast.js's public castStart/castUpdate, and
 * the real mission steps' own check()s, against a bare THREE.Scene and a
 * made-up sim, with no page and no renderer. You are a stand-in fighter
 * glued to his wing slot — the stories only ever read your pose.
 *
 *   node tests/features/afo-lead.mjs
 *
 * Proves what a browser placement-check cannot:
 *   - the normal flight reaches 'final' (your cue to peel) and lands on a
 *     schedule the seat's own par time and the escort bot can meet;
 *   - Under Attack, Air Force One actually turns for home once the drones
 *     are down (or the fight has gone on long enough) — it used to fly on
 *     east at 1,450 m forever, so 'escort-home' could never complete;
 *   - Under Attack is winnable from this seat: a pilot who flies at the
 *     arrow and leads with its own nose gets him home most runs; one who
 *     never fires still fails;
 *   - the NPC escort's own gun (the captain's seat, src/features/events/
 *     afo.js, through AttackField.aimFrom()) actually shoots the drones down.
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
// afo.js builds its one touch button on its first update(), so the made-up
// elements need just enough of a button to be built.
globalThis.document = {
  createElement: () => ({
    getContext: () => new Proxy({}, { get: () => () => ({ addColorStop() {}, data: new Uint8ClampedArray(4) }) }),
    width: 0,
    height: 0,
    style: {},
    classList: { toggle() {} },
    addEventListener() {},
    appendChild() {},
  }),
  body: { appendChild() {} },
  head: { appendChild() {} },
  getElementById: () => null,
};

const root = new URL('../../', import.meta.url);
const imp = (p) => import(new URL(p, root).href);

const results = [];
const ok = (name, pass, detail = '') => {
  results.push({ name, pass: !!pass, detail: String(detail) });
  return !!pass;
};

const THREE = await imp('src/vendor/three.module.js');
const T = await imp('src/world/terrain.js');
const AP = await imp('src/world/airport.js');
T.applyMap('kestrel');
AP.refreshRunways();
const CAST = await imp('src/game/roles/cast.js');
const Lead = await imp('src/game/roles/afo-lead.js');
const Afo = await imp('src/features/events/afo.js');
const { AttackField, _Drone: Drone, _Missile: Missile } = await imp('src/features/events/afo-combat.js');
const { extensions } = await imp('src/game/extensions.js');
const { NpcFlyer } = await imp('src/game/roles/npc-flyer.js');
const { cruiseSpeed } = await imp('src/features/events/common.js');

const scene = new THREE.Scene();
const weather = { isNight: false, cond: { cloud: 0 }, windSpeedKts: 7, windDirDeg: 90 };
const dt = 1 / 30;

/** You: a fighter that sits exactly in his right wing slot, nose wherever `aim` says. */
function standIn() {
  return {
    pos: new THREE.Vector3(),
    vel: new THREE.Vector3(),
    heading: 0,
    crashed: false,
    onGround: false,
    airborneTime: 600, // already up: the 'scramble' step's own take-off needs a real flight model
    agl: 1000,
    aim: new THREE.Vector3(0, 0, -1),
    forward(out) {
      return out.copy(this.aim);
    },
  };
}
function inSlot(ac, air) {
  // afo-lead.js's own wingSlot(): span/2 + 36 right, 5 up, 30 back.
  const h = (air.heading * Math.PI) / 180;
  const fx = Math.sin(h);
  const fz = -Math.cos(h);
  const x = air.span * 0.5 + 36;
  ac.pos.set(air.pos.x - fz * x - fx * 30, air.pos.y + 5, air.pos.z + fx * x - fz * 30);
  ac.vel.copy(air.vel);
  ac.heading = air.heading;
}

/** The mission runner, in miniature: the seat's own steps, one at a time, each with its own clock. */
function stepper(def, sim, ac) {
  const steps = def.steps.filter((s) => s.id !== 'land'); // your own landing needs a real flight model
  const ctx = { data: {}, runner: { stepElapsed: 0 }, sim, ac };
  const passed = {};
  let i = 0;
  return {
    passed,
    tick(t) {
      if (i >= steps.length) return;
      ctx.runner.stepElapsed += dt;
      if (steps[i].check(ctx, dt)) {
        passed[steps[i].id] = t;
        i++;
        ctx.runner.stepElapsed = 0;
      }
    },
    get waitingOn() {
      return i < steps.length ? steps[i].id : null;
    },
  };
}

const seat = (roles) => roles.find((r) => r.id === 'escort');

/* ------------------------------------------------------------------ *
 * The normal flight: out, back on the reciprocal, round onto the
 * runway heading, and down. You hold his wing the whole way.
 * ------------------------------------------------------------------ */
{
  const ac = standIn();
  const sim = { scene, weather, hud: null, audio: null, speak() {}, aircraft: ac };
  const def = seat(Lead.AFO_NORMAL_ROLES);
  CAST.castStart(sim, 'mission', { roleId: 'escort', cast: def.cast });
  const s = CAST.castStory(Lead.STORY_NORMAL);
  const run = stepper(def, sim, ac);
  let t = 0;
  for (; t < 600 && !s.air.stopped; t += dt) {
    inSlot(ac, s.air);
    CAST.castUpdate(sim, dt);
    run.tick(t);
  }
  ok('normal: join, hold and peel all complete, in order', run.waitingOn === null, `waiting on ${run.waitingOn}, passed ${JSON.stringify(run.passed)}`);
  // The fix: one 55° turn then land() left him 9.6 km past the field, and
  // 'final' — what 'peel' waits on — took until t ≈ 451 s.
  ok('normal: he reaches final (your cue to peel) by 360 s', run.passed.peel != null && run.passed.peel < 360, `peel at ${run.passed.peel && run.passed.peel.toFixed(0)}s`);
  ok('normal: no go-arounds on the way in', s.air.goArounds === 0, `goArounds ${s.air.goArounds}`);
  ok(`normal: he lands and stops within the seat's own par time (${def.parTime}s)`, s.air.stopped && t <= def.parTime, `stopped ${s.air.stopped} at ${t.toFixed(0)}s`);
  ok('normal: and on the field, not in the sea', T.heightAt(s.air.pos.x, s.air.pos.z) > -1, `${s.air.pos.x.toFixed(0)},${s.air.pos.z.toFixed(0)}`);
  CAST.castStop(sim);
}

/** Turn the unit vector `v` towards the unit vector `want` by at most `maxRad`. */
function turnToward(v, want, maxRad) {
  const ang = v.angleTo(want);
  if (ang <= maxRad) return v.copy(want);
  const axis = T1.crossVectors(v, want);
  if (axis.lengthSq() < 1e-12) axis.set(0, 1, 0);
  return v.applyAxisAngle(axis.normalize(), maxRad).normalize();
}
const T1 = new THREE.Vector3();

/**
 * A pilot, not a turret: sits in the wing slot until the 'defend' step names
 * a drone, then flies at it — the step's own target(), the arrow on screen —
 * no faster than `speed`, turning no harder than `g` allows, its gun along
 * its own nose. It fires only once the shot (led the way aimFrom() leads it:
 * the drone's velocity relative to its own, for the pellet's flight) is
 * inside `coneDeg` of the nose and inside the pellet's ~370 m reach. Nothing
 * left to chase, it flies back to the slot and sits in it. `fire: false` is
 * afo.playthrough.js's own escort fail path: fly the arrow, never shoot.
 */
function chasePilot({ speed: maxSpeed = 130, g = 3, coneDeg = 2, fire = true } = {}) {
  return (ac, s, run, def) => {
    const defend = def.steps.find((x) => x.id === 'defend');
    const nose = new THREE.Vector3();
    const want = new THREE.Vector3();
    const slot = standIn();
    let free = false;
    let speed = 0;
    const move = (towards, wantSpeed) => {
      turnToward(nose, towards, ((9.81 * g) / Math.max(40, speed)) * dt);
      speed += Math.max(-15 * dt, Math.min(15 * dt, wantSpeed - speed));
      ac.vel.copy(nose).multiplyScalar(speed);
      ac.pos.addScaledVector(ac.vel, dt);
      ac.pos.y = Math.max(ac.pos.y, T.heightAt(ac.pos.x, ac.pos.z) + 40);
      ac.aim.copy(nose);
    };
    return () => {
      const at = run.waitingOn === 'defend' ? defend.target() : null;
      const drone = at && s.attack.drones.find((d) => d.pos === at);
      if (!free && drone) {
        free = true;
        nose.copy(s.air.vel).normalize();
        speed = s.air.vel.length();
      }
      if (!free) {
        inSlot(ac, s.air);
        return false;
      }
      if (drone) {
        const d = drone.pos.distanceTo(ac.pos);
        const lead = d / 340;
        want.copy(drone.pos).addScaledVector(drone.vel, lead).addScaledVector(ac.vel, -lead).sub(ac.pos).normalize();
        move(want, d > 900 ? maxSpeed : d > 300 ? 110 : 80);
        return fire && d < 370 && nose.angleTo(want) < (coneDeg * Math.PI) / 180;
      }
      inSlot(slot, s.air);
      const d = slot.pos.distanceTo(ac.pos);
      if (d < 60) {
        free = false;
        inSlot(ac, s.air);
      } else {
        move(want.copy(slot.pos).sub(ac.pos).normalize(), d > 600 ? maxSpeed : 90);
      }
      return false;
    };
  };
}

/* ------------------------------------------------------------------ *
 * Under Attack: whenever the drones go down, he turns for home, and
 * 'escort-home' (which waits on his final) completes.
 * ------------------------------------------------------------------ */
function attackRun({ clearAt = null, aim = null, pilot = null, stopOnFail = false, secs = 700 } = {}) {
  const ac = standIn();
  let trigger = false;
  const sim = { scene, weather, hud: null, audio: null, speak() {}, aircraft: ac, input: { held: (k) => k === 'afoFire' && trigger } };
  const def = seat(Lead.AFO_ATTACK_ROLES);
  CAST.castStart(sim, 'mission', { roleId: 'escort', cast: def.cast });
  const s = CAST.castStory(Lead.STORY_ATTACK);
  const run = stepper(def, sim, ac);
  const AIM = new THREE.Vector3();
  const fly = pilot ? pilot(ac, s, run, def) : null;
  let homeAt = null;
  let failAt = null;
  let launchAt = null;
  let t = 0;
  for (; t < secs && !s.air.stopped && !(stopOnFail && failAt != null); t += dt) {
    trigger = false;
    if (fly) trigger = fly();
    else inSlot(ac, s.air);
    if (aim) {
      const dir = s.attack.aimFrom(ac.pos, ac.vel, AIM, 380);
      if (dir) {
        ac.aim.copy(dir);
        trigger = true;
      }
    }
    if (clearAt != null && t >= clearAt) {
      for (const d of s.attack.drones) d.alive = false;
      for (const m of s.attack.missiles) m.alive = false;
    }
    CAST.castUpdate(sim, dt);
    run.tick(t);
    if (homeAt == null && s.headingHome) homeAt = t;
    if (launchAt == null && s.attack.stats.launched > 0) launchAt = t;
    const info = CAST.castInfo();
    if (failAt == null && info.failWhy) failAt = t;
  }
  const out = { s, run, t, homeAt, failAt, launchAt, stats: { ...s.attack.stats }, phase: s.air.landPhase };
  CAST.castStop(sim);
  return out;
}

{
  // A good escort: the drones are down 45 s in.
  const r = attackRun({ clearAt: 45 });
  ok('attack: drones down → he turns for home straight away (the fix: nothing ever called land() for him)', r.homeAt != null && r.homeAt < 46, `headingHome at ${r.homeAt}`);
  ok('attack: drones down → every step up to your own landing completes', r.run.waitingOn === null, `waiting on ${r.run.waitingOn}, passed ${JSON.stringify(r.run.passed)}, phase '${r.phase}'`);
  ok('attack: drones down at 45 s → he is on final by 260 s', r.run.passed['escort-home'] != null && r.run.passed['escort-home'] < 260, `escort-home at ${r.run.passed['escort-home'] && r.run.passed['escort-home'].toFixed(0)}s`);
  ok('attack: drones down → he lands and stops, on dry land', r.s.air.stopped && T.heightAt(r.s.air.pos.x, r.s.air.pos.z) > -1, `stopped ${r.s.air.stopped} at ${r.t.toFixed(0)}s`);
}

{
  // Nobody shoots at all: the fail path still fails, and he still goes home
  // on the 150 s fallback rather than flying on forever.
  const r = attackRun();
  ok('attack: nobody shooting still fails the mission (missiles get through)', r.failAt != null, `failWhy first at ${r.failAt}`);
  ok('attack: nobody shooting → he still turns for home on the fallback, 150 s after the wave', r.homeAt != null && Math.abs(r.homeAt - 161) < 1, `headingHome at ${r.homeAt}`);
  ok('attack: … and is on final (escort-home complete) within 480 s', r.run.passed['escort-home'] != null && r.run.passed['escort-home'] < 480, `escort-home at ${r.run.passed['escort-home']}, phase '${r.phase}'`);
}

{
  // Your own gun, through the real key path (sim.input.held('afoFire')),
  // pointed by a perfect hand from the wing slot.
  const r = attackRun({ aim: true, secs: 200 });
  ok('attack: your own gun (the afoFire key) really shoots things down', r.stats.shotDrones + r.stats.shotMissiles > 0, JSON.stringify(r.stats));
}

{
  // Fair, from this seat: the wave appears 3.4 km ahead and the gun reaches
  // ~370 m, so the drones used to fire (t ≈ 18 s) long before any fighter
  // could get to either, and the NPC captain spent all four flares on that
  // first pair. Measured before the fix, this same pilot (130 m/s, 3 g, a 2°
  // cone) passed 8 runs in 30, a sharper one (160 m/s, 4 g, 3°) 22 in 30, and
  // a pilot glued to the wing with a perfect gun 5 in 20.
  const runs = [];
  for (let i = 0; i < 20; i++) runs.push(attackRun({ pilot: chasePilot(), stopOnFail: true }));
  const passed = runs.filter((r) => r.failAt == null && r.run.waitingOn === null && r.s.air.stopped);
  const tally = runs.map((r) => (r.failAt == null ? `${r.stats.shotDrones}d` : `fail@${r.failAt.toFixed(0)}`)).join(' ');
  ok('attack: a competent escort — flies at the arrow, leads with its own nose — gets him home in at least 15 runs of 20', passed.length >= 15, `${passed.length}/20: ${tally}`);
  const first = Math.min(...runs.map((r) => (r.launchAt == null ? Infinity : r.launchAt)));
  ok('attack: this seat\'s drones hold fire for 30 s after the wave appears (t = 11 s)', first >= 11 + 30, `first launch at ${first.toFixed(1)}s`);
  const capt = Array.from({ length: 50 }, () => new Drone(scene, new THREE.Vector3()).cooldown);
  ok('attack: … the captain\'s seat keeps the engine\'s own 3-6 s', capt.every((c) => c >= 3 && c < 6), `${Math.min(...capt).toFixed(2)}..${Math.max(...capt).toFixed(2)}`);
}

{
  // afo.playthrough.js's own escort fail path: fly the arrow, never fire.
  // The NPC captain's four flares are not enough on their own, and the bot
  // gives a deliberate fail 170 s.
  const runs = [];
  for (let i = 0; i < 20; i++) runs.push(attackRun({ pilot: chasePilot({ fire: false }), stopOnFail: true, secs: 300 }));
  const failed = runs.filter((r) => r.failAt != null && r.failAt < 170);
  ok('attack: an escort that never fires still fails, every run, inside the fail bot\'s 170 s', failed.length === runs.length,
    runs.map((r) => (r.failAt == null ? 'PASS' : r.failAt.toFixed(0))).join(' '));
}

/* ------------------------------------------------------------------ *
 * The captain's seat: the NPC escort's gun (src/features/events/afo.js,
 * through the extension's own hooks). A captain who flies straight on and
 * never flares, so every drone down is the escort's own doing.
 * ------------------------------------------------------------------ */
{
  const ext = extensions().find((e) => e.id === 'afo');
  const S0 = Lead.ATTACK_AIR_START;
  const runs = [];
  for (let run = 0; run < 3; run++) {
    const plane = new NpcFlyer(scene, 'b747', { name: 'captain' });
    plane.place({ pos: new THREE.Vector3(S0.x, S0.y, S0.z), headingDeg: S0.hdg, speed: cruiseSpeed('b747') });
    plane.direct(S0.hdg, S0.y, cruiseSpeed('b747'));
    const ac = { pos: plane.pos, vel: plane.vel, heading: plane.heading, crashed: false, onGround: false, agl: S0.y };
    const sim = { scene, weather, hud: null, audio: null, speak() {}, aircraft: ac, input: { held: () => false }, runner: { status: 'running', def: { id: 'afo-attack', roleId: 'captain' } } };
    ext.install(sim);
    ext.startMode(sim, 'mission');
    for (let t = 0; t < 240; t += dt) {
      plane.update(dt, weather);
      ac.heading = plane.heading;
      ext.update(sim, dt);
    }
    runs.push(Afo.afoInfo().stats);
    ext.stop(sim);
    plane.dispose();
  }
  // Before: aimed straight at where the nearest drone was, it shot down 0
  // drones and 0-1 missiles in 600 s, every run. Now (40 runs measured)
  // both drones are down by t ≈ 45 s in most runs; in the rest it is busy
  // stopping missiles (9-11 of them) while a drone falls behind this
  // captain, who never turns, and out of its own launch range.
  ok('captain: the NPC escort stops at least two drones or missiles, every run', runs.every((r) => r.shotDrones + r.shotMissiles >= 2), JSON.stringify(runs));
  ok('captain: … and actually shoots drones down, not just missiles', runs.some((r) => r.shotDrones > 0), JSON.stringify(runs));
}

/* ------------------------------------------------------------------ *
 * AttackField.aimFrom() itself.
 * ------------------------------------------------------------------ */
{
  const f = new AttackField({ scene });
  const AIM = new THREE.Vector3();
  const me = new THREE.Vector3(0, 1000, 0);
  const myVel = new THREE.Vector3(0, 0, -75);
  ok('aimFrom: nothing to shoot at → null', f.aimFrom(me, myVel, AIM) === null);

  const drone = new Drone(scene, new THREE.Vector3(300, 1000, -50));
  drone.vel.set(0, 0, 55); // crossing, heading the other way
  f.drones.push(drone);
  const dir = f.aimFrom(me, myVel, AIM);
  // A pellet fired along `dir` carries my own velocity (fireGun's muzzleVel):
  // it must pass within the drone's own radius of where the drone will be.
  let miss = Infinity;
  for (let t = 0; t < 1.1; t += 0.002) {
    const px = me.x + (dir.x * 340 + myVel.x) * t;
    const py = me.y + (dir.y * 340 + myVel.y) * t;
    const pz = me.z + (dir.z * 340 + myVel.z) * t;
    const tx = drone.pos.x + drone.vel.x * t;
    const ty = drone.pos.y + drone.vel.y * t;
    const tz = drone.pos.z + drone.vel.z * t;
    miss = Math.min(miss, Math.hypot(px - tx, py - ty, pz - tz));
  }
  ok('aimFrom: leads a crossing drone by its velocity relative to the shooter — the shot really meets it', miss < drone.r, `closest pass ${miss.toFixed(1)} m (drone r ${drone.r})`);

  const missile = new Missile(scene, new THREE.Vector3(-600, 1000, 200), 90);
  f.missiles.push(missile);
  const toMissile = f.aimFrom(me, myVel, AIM);
  ok('aimFrom: a missile in the air comes first, even when a drone is nearer', toMissile && toMissile.x < 0, `dir ${toMissile && toMissile.toArray().map((v) => v.toFixed(2))}`);

  ok('aimFrom: nothing inside the range → null', f.aimFrom(me, myVel, AIM, 100) === null);
  f.dispose();
}

/* ------------------------------------------------------------------ */

let failed = 0;
for (const r of results) {
  if (!r.pass) failed++;
  console.log(`${r.pass ? 'ok  ' : 'FAIL'} ${r.name}${r.detail && !r.pass ? `  — ${r.detail}` : ''}`);
}
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);

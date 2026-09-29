/**
 * Node checks for the weapons work: explosions.js, meteor.js and the meteor
 * missions. Run from anywhere with plain node:
 *
 *   node tests/features/weapons.mjs
 *
 * These drive the real modules against a real THREE.Scene and the real
 * terrain height function, with a stand-in for the game object (no renderer,
 * no audio, no DOM beyond the stub below). They check the physics and the
 * rules — when the boom arrives, where the splash goes, that a big meteor is
 * warned about and does not land on you, that the dodge rocks are aimed at
 * where you will be, that the pools do not grow — not the pixels. The browser
 * half is tests/features/weapons.browser.js.
 *
 * Exit code 1 if anything fails.
 */

// The DOM stub from the brief: enough for canvas textures and the overlay layer.
globalThis.document = {
  createElement: () => ({
    getContext: () => new Proxy({}, { get: () => () => ({ addColorStop() {}, data: new Uint8ClampedArray(4) }) }),
    width: 0,
    height: 0,
    style: {},
  }),
  body: { appendChild() {} },
};

/*
 * Every random choice in these modules is Math.random at call time. The
 * suite seeds it and prints the seed, so a run that fails can be replayed
 * exactly with SEED=<n>. Each run still takes a new seed unless told
 * otherwise, so running it again samples new meteors — that is how the two
 * flaky checks were found (3 failures in 15 runs), and how the fixes were
 * shown to hold (see the sweep in the commit that added this).
 */
const SEED = process.env.SEED ? Number(process.env.SEED) >>> 0 : ((Date.now() ^ (process.pid << 10)) >>> 0);
Math.random = (() => {
  let a = SEED || 1;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
})();
console.log(`seed ${SEED}  (replay this run with SEED=${SEED} node tests/features/weapons.mjs)`);

const here = new URL('.', import.meta.url);
const src = (p) => new URL(`../../src/${p}`, here).href;

const results = [];
function ok(name, pass, detail = '') {
  results.push({ name, pass: !!pass, detail: String(detail) });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail !== '' ? `  — ${detail}` : ''}`);
  return !!pass;
}

let THREE, Terrain, FX, MET, MIS, ALL, EXT, MARK, TYPES, RUN;
try {
  THREE = await import(src('vendor/three.module.js'));
  Terrain = await import(src('world/terrain.js'));
  EXT = await import(src('game/extensions.js'));
  FX = await import(src('features/explosions.js'));
  MET = await import(src('features/meteor.js'));
  MIS = await import(src('game/extra/meteor.js'));
  ALL = await import(src('game/missions.js'));
  MARK = await import(src('game/markers.js'));
  TYPES = await import(src('aircraft/types.js'));
  RUN = await import(src('game/runner.js'));
  ok('every module imports and links in node', true);
} catch (err) {
  ok('every module imports and links in node', false, err && err.stack);
  process.exit(1);
}

Terrain.applyMap('kestrel');
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const D2R = Math.PI / 180;

/* ------------------------------------------------------------------ */
/* A stand-in for the game                                             */
/* ------------------------------------------------------------------ */

function makeSim() {
  const sim = {
    scene: new THREE.Scene(),
    camera: new THREE.PerspectiveCamera(65, 16 / 9, 0.1, 60000),
    settings: { quality: 'high', reducedMotion: false, showHints: false },
    weather: { windVector: (o) => o.set(4, 0, 1) },
    kicks: [],
    notes: [],
    said: [],
    sky: { hemi: { intensity: 1 } },
    state: 'flying',
    mode: 'mission',
    _cargo: false,
    aircraftType: { id: 'skylark' },
    aircraft: {
      pos: V(-3000, 650, 900),
      vel: V(),
      quat: new THREE.Quaternion(),
      heading: 60,
      agl: 684,
      vs: 0,
      crashed: false,
      on() { return this; },
    },
  };
  sim.rig = { kick: (a) => sim.kicks.push(a), initialised: true, mode: 'chase' };
  sim.hud = { notify: (t) => sim.notes.push(t) };
  sim.speak = (t) => sim.said.push(t);
  Object.defineProperty(sim, 'hasCargo', { get() { return this._cargo; }, set(v) { this._cargo = !!v; } });
  sim.runner = new RUN.MissionRunner(sim);
  for (const e of EXT.extensions()) if (e.install) e.install(sim);
  for (const e of EXT.extensions()) {
    if (!e.buildWorld) continue;
    const g = new THREE.Group();
    sim.scene.add(g);
    e.buildWorld(sim, g);
  }
  setHeading(sim, 60, 62);
  return sim;
}

function setHeading(sim, h, speed = 62) {
  const ac = sim.aircraft;
  ac.heading = ((h % 360) + 360) % 360;
  ac.quat.setFromAxisAngle(V(0, 1, 0), -ac.heading * D2R);
  ac.vel.set(Math.sin(ac.heading * D2R), 0, -Math.cos(ac.heading * D2R)).multiplyScalar(speed);
}

function chaseCam(sim) {
  const ac = sim.aircraft;
  const back = V(0, 0, 1).applyQuaternion(ac.quat);
  sim.camera.position.copy(ac.pos).addScaledVector(back, 22).add(V(0, 6, 0));
  sim.camera.lookAt(ac.pos);
  sim.camera.updateMatrixWorld();
}

const hook = (id) => EXT.extensions().find((e) => e.id === id);
const pct = (arr, p) => {
  const a = Array.from(arr).sort((x, y) => x - y);
  return a[Math.min(a.length - 1, Math.floor(p * a.length))];
};
const median = (arr) => pct(arr, 0.5);

/** One frame of the game as far as the features are concerned. */
function frame(sim, dt, move = true) {
  const ac = sim.aircraft;
  if (move) ac.pos.addScaledVector(ac.vel, dt);
  ac.agl = ac.pos.y - Terrain.heightAt(ac.pos.x, ac.pos.z);
  chaseCam(sim);
  sim.sky.hemi.intensity = 1;
  for (const e of EXT.extensions()) if (e.update) e.update(sim, dt);
}

function run(sim, seconds, dt = 1 / 30, each = null) {
  const n = Math.round(seconds / dt);
  for (let i = 0; i < n; i++) {
    if (each) each(i, i * dt);
    frame(sim, dt);
  }
}

const findByName = (root, name) => {
  let hit = null;
  root.traverse((o) => { if (!hit && o.name === name) hit = o; });
  return hit;
};
const countObjects = (root) => {
  let n = 0;
  root.traverse(() => n++);
  return n;
};

/* ------------------------------------------------------------------ */
/* Registration and the missions list                                  */
/* ------------------------------------------------------------------ */

const status = EXT.extStatus();
ok('explosions and meteor both register as live extensions', ['explosions', 'meteor'].every((id) => status.some((s) => s.id === id && s.live)), JSON.stringify(status));
ok('explosions registers before meteor (its particles age before meteor re-draws its heads)',
  status.findIndex((s) => s.id === 'explosions') < status.findIndex((s) => s.id === 'meteor'));
ok('explode() is exported with the contract signature', typeof FX.explode === 'function' && FX.explode.length >= 2);
ok('the dev panel offers "Start meteor shower"', (hook('meteor').devActions || []).some((a) => a.label === 'Start meteor shower'));

const mets = MIS.MISSIONS;
ok('four meteor missions', mets.length === 4, mets.map((m) => m.id).join(', '));
const ids = ALL.MISSIONS.map((m) => m.id);
ok('mission ids are unique across the whole game', new Set(ids).size === ids.length);
const AC = new Set(TYPES.AIRCRAFT.map((a) => a.id));
for (const m of mets) {
  const probs = [];
  if (m.category !== 'meteor') probs.push('category');
  if (m.game !== 'flight') probs.push('game');
  for (const k of ['id', 'name', 'short', 'blurb', 'reward', 'icon']) if (typeof m[k] !== 'string' || !m[k]) probs.push(k);
  if (!['Easy', 'Medium', 'Hard'].includes(m.difficulty)) probs.push('difficulty');
  if (!m.meteor || !['shower', 'dodge', 'town', 'photo'].includes(m.meteor.mode)) probs.push('meteor.mode');
  if (typeof m.onStart !== 'function') probs.push('onStart');
  if (!Array.isArray(m.steps) || !m.steps.length || m.steps.some((s) => !s.id || !s.text || typeof s.check !== 'function')) probs.push('steps');
  if (m.aircraft && !AC.has(m.aircraft)) probs.push(`aircraft ${m.aircraft}`);
  if (!ALL.findMission(m.id)) probs.push('not found by findMission');
  Terrain.applyMap(m.map || 'kestrel');
  const sp = m.spawn;
  const alt = sp && sp.altAGL;
  const p = sp && sp.pos;
  const msl = p ? Terrain.heightAt(p.x, p.z) + alt : NaN;
  const clear = p ? msl - Math.max(0, Terrain.heightAt(p.x, p.z)) : NaN;
  if (!(clear >= 150)) probs.push(`spawn only ${Math.round(clear)} m clear of the surface`);
  ok(`mission ${m.id} has the full shape and starts ${Math.round(clear)} m up`, probs.length === 0, probs.join('; '));
}
Terrain.applyMap('kestrel');

/* ------------------------------------------------------------------ */
/* Explosions                                                           */
/* ------------------------------------------------------------------ */

ok('sound takes 1 s to go 340 m and 5 s to go 1.7 km', FX.soundDelay(340) === 1 && Math.abs(FX.soundDelay(1700) - 5) < 1e-9);

{
  const sim = makeSim();
  sim.aircraft.pos.set(-1200, 400, 0);
  setHeading(sim, 90, 0);
  chaseCam(sim);
  const cam = sim.camera.position.clone();
  const target = V(cam.x + 1020, 0, cam.z);
  target.y = Terrain.heightAt(target.x, target.z);
  const r = FX.explode(sim, target, { size: 1, kind: 'bomb' });
  const d = r.distance;
  let t = 0;
  let heardAt = null;
  const id = r.id;
  while (t < 10 && heardAt === null) {
    frame(sim, 1 / 60, false);
    t += 1 / 60;
    const lb = FX.explosionStats().lastBoom;
    if (lb && lb.id === id) heardAt = t;
  }
  ok('the boom arrives when the sound would, not when the flash does', heardAt !== null && Math.abs(heardAt - d / 340) < 1 / 30,
    `distance ${Math.round(d)} m, heard at ${heardAt && heardAt.toFixed(3)} s, sound says ${(d / 340).toFixed(3)} s`);
  ok('a blast 1 km away lands on the ground, not in the air or the sea', !r.water && !r.air);
}

{
  // Running away from it: the wave has to catch you, so it arrives later.
  const sim = makeSim();
  sim.aircraft.pos.set(-1200, 400, 0);
  setHeading(sim, 270, 150);
  chaseCam(sim);
  const cam0 = sim.camera.position.clone();
  const r = FX.explode(sim, V(cam0.x + 700, 20, cam0.z), { size: 1 });
  let t = 0;
  let heardAt = null;
  while (t < 20 && heardAt === null) {
    frame(sim, 1 / 60);
    t += 1 / 60;
    const lb = FX.explosionStats().lastBoom;
    if (lb && lb.id === r.id) heardAt = t;
  }
  const still = r.distance / 340;
  // Where the wave front (340 t) meets the listener, who is moving away along x at 150 m/s.
  const dx = r.x - cam0.x;
  const dy = r.y - cam0.y;
  const dz = r.z - cam0.z;
  let chase = still;
  for (let k = 0; k < 60; k++) chase = Math.hypot(dx + 150 * chase, dy, dz) / 340;
  ok('flying away from a blast, the boom has to catch you up', heardAt !== null && heardAt > still + 0.5 && Math.abs(heardAt - chase) < 0.05,
    `heard at ${heardAt && heardAt.toFixed(2)} s; standing still would be ${still.toFixed(2)} s, the wave front meets you at ${chase.toFixed(2)} s`);
}

{
  const sim = makeSim();
  const sea = FX.explode(sim, V(3000, 3, 3000), { size: 2, kind: 'meteor' });
  const land = FX.explode(sim, V(0, Terrain.heightAt(0, 0), 0), { size: 1 });
  const air = FX.explode(sim, V(0, Terrain.heightAt(0, 0) + 300, 0), { size: 1 });
  const odd = FX.explode(sim, V(0, 20, 0), { size: 1, kind: 'kaboom' });
  ok('over the sea it is a splash at the surface', sea.water && sea.y === 0 && !sea.air, JSON.stringify({ water: sea.water, y: sea.y }));
  ok('on the island it is a ground blast', !land.water && !land.air);
  ok('300 m up it is an airburst', air.air && !air.water);
  ok('an unknown kind is treated as a bomb', odd.kind === 'bomb');
  ok('bad input is refused, not thrown', FX.explode(sim, null) === null && FX.explode(null, V()) === null && FX.explode(sim, { x: NaN, y: 0, z: 0 }) === null);
}

{
  const sim = makeSim();
  sim.aircraft.pos.set(-300, 300, 0);
  setHeading(sim, 90, 0);
  chaseCam(sim);
  const base = 1;
  FX.explode(sim, V(-100, Terrain.heightAt(-100, 0), 0), { size: 1 });
  frame(sim, 1 / 60, false);
  const lit = sim.sky.hemi.intensity;
  const light = FX.explosionStats().light;
  run(sim, 2, 1 / 60);
  const kicked = sim.kicks.slice();
  ok('a close blast brightens the sky for a moment', lit > base + 0.2, `hemisphere ${base} -> ${lit.toFixed(2)}`);
  ok('and lights the ground with a real light', light > 1000, `point light ${Math.round(light)}`);
  ok('and shakes the camera when the wave arrives', kicked.some((k) => k > 0.2), kicked.map((k) => k.toFixed(2)).join(', '));
  run(sim, 14, 1 / 30);
  ok('the light is off again once it has burned down', FX.explosionStats().light === 0, FX.explosionStats().light);
  sim.kicks.length = 0;
  FX.explode(sim, V(4000, 0, 3000), { size: 1 });
  run(sim, 16, 1 / 30);
  ok('a blast five kilometres away does not shake anything', sim.kicks.length === 0, sim.kicks.join(', '));
}

{
  // The scorch mark lies on the ground as drawn.
  const sim = makeSim();
  const x = 1350;
  const z = 1400; // South Kestrel Hills — a slope
  FX.explode(sim, V(x, Terrain.heightAt(x, z), z), { size: 1.5, kind: 'meteor' });
  const dec = findByName(sim.scene, 'fx-decals');
  const P = dec.geometry.attributes.position.array;
  let worst = 0;
  let n = 0;
  for (let i = 0; i < P.length; i += 3) {
    if (P[i + 1] < -9000) continue;
    n++;
    worst = Math.max(worst, Math.abs(P[i + 1] - 0.3 - FX.renderedHeight(P[i], P[i + 2], 'high')));
  }
  ok('a crater on a hillside follows the drawn ground at every vertex', n === 49 && worst < 1e-3, `${n} vertices, worst ${worst.toFixed(4)} m off`);
  // renderedHeight is heightAt at a mesh vertex and inside its triangle between.
  const c = Terrain.MAP.chunks[0];
  const sp = c.size / c.segments;
  const vx = c.cx - c.size / 2 + 101 * sp;
  const vz = c.cz - c.size / 2 + 153 * sp;
  const atVertex = Math.abs(FX.renderedHeight(vx, vz) - Terrain.heightAt(vx, vz));
  const mid = FX.renderedHeight(vx + sp * 0.3, vz + sp * 0.2);
  const corners = [Terrain.heightAt(vx, vz), Terrain.heightAt(vx + sp, vz), Terrain.heightAt(vx, vz + sp)];
  ok('renderedHeight matches the mesh at a vertex and stays inside its triangle', atVertex < 1e-6 && mid >= Math.min(...corners) - 1e-6 && mid <= Math.max(...corners) + 1e-6,
    `vertex error ${atVertex}, mid ${mid.toFixed(2)} in [${Math.min(...corners).toFixed(2)}, ${Math.max(...corners).toFixed(2)}]`);
}

{
  // Twenty in a row, the Chromebook test: nothing new in the scene, nothing
  // over its cap, and the per-frame cost stays small.
  const sim = makeSim();
  sim.aircraft.pos.set(-900, 350, 0);
  setHeading(sim, 90, 0);
  run(sim, 1, 1 / 30); // warm up
  const before = countObjects(sim.scene);
  for (let i = 0; i < 20; i++) FX.scheduleExplosion(V(-400 + i * 60, 0, 60), { size: 1 }, i * 0.2);
  const caps = FX.explosionStats().caps;
  let over = '';
  const n = 30 * 12;
  const times = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const t0 = performance.now();
    frame(sim, 1 / 30, false);
    times[i] = performance.now() - t0;
    const s = FX.explosionStats();
    if (s.glow > caps.glow + 400 || s.smoke > caps.smoke || s.debris > caps.debris || s.decals > caps.decals) over = JSON.stringify(s);
  }
  const after = countObjects(sim.scene);
  ok('twenty blasts add no objects to the scene (all pooled)', after === before, `${before} -> ${after}`);
  ok('no pool ever goes over its cap', over === '', over);
  // The median, not the mean: this machine is shared, and one descheduled
  // frame (measured: 170 ms, with the load average over 100) is not the code.
  ok('twenty in a row cost under 2 ms a frame here (median frame)', median(times) < 2, `median ${median(times).toFixed(3)} ms, 90th ${pct(times, 0.9).toFixed(3)} ms`);
  ok('all twenty went off and were heard', FX.explosionStats().booms >= 20, `booms ${FX.explosionStats().booms}`);
  FX.clearExplosions();
  const s = FX.explosionStats();
  ok('clearExplosions() leaves nothing behind', s.blasts === 0 && s.glow === 0 && s.smoke === 0 && s.debris === 0 && s.decals === 0, JSON.stringify(s));
}

/* ------------------------------------------------------------------ */
/* The practice bomb, through the update hook                          */
/* ------------------------------------------------------------------ */

/**
 * One bomb, driven the way main.js drives it: the bomb's own update(), then
 * main.js's `justExploded` check (which plays the thunder clip and clears
 * the flag), then the features' update hook.
 */
function dropBomb(sim, x, z, altMsl, vel) {
  const heightAt = Terrain.heightAt;
  const bomb = new MARK.PracticeBomb(sim.scene, V(x, altMsl, z), vel);
  sim.crate = bomb;
  const wind = V(2, 0, 0);
  let t = 0;
  let splashT = null;
  let landedT = null;
  let thunders = 0;
  let after = 0;
  const blastsNow = () => FX.explosionStats().blasts;
  const b0 = blastsNow();
  while (t < 30 && (!bomb.landed || t < (landedT || 0) + 0.5)) {
    bomb.update(1 / 60, heightAt, wind);
    t += 1 / 60;
    if (bomb.landed && landedT === null) landedT = t;
    if (landedT !== null) after++;
    if (splashT === null && blastsNow() > b0) splashT = t;
    if (bomb.justExploded) {
      bomb.justExploded = false;
      thunders++;
    }
    frame(sim, 1 / 60, false);
    if (splashT === null && blastsNow() > b0) splashT = t;
  }
  // after: frames run from the landing frame on, that one included.
  return { bomb, t: landedT === null ? t : landedT, splashT, thunders, after };
}

{
  const sim = makeSim();
  sim.aircraft.pos.set(-600, 500, -100);
  const { bomb, splashT, t, thunders } = dropBomb(sim, -300, 0, 330, V(70, 0, 0));
  const legacy = ['fire', 'ring', 'dust', 'scorch'].every((k) => bomb[k].material.visible === false);
  ok('a practice bomb on land goes off through explode()', bomb.landed && splashT !== null, `landed ${bomb.landed}, bang at ${splashT && splashT.toFixed(2)} s`);
  ok('on the very frame it lands, not a frame later', splashT !== null && Math.abs(splashT - t) < 1e-9, `landed ${t.toFixed(3)} s, bang ${splashT && splashT.toFixed(3)} s`);
  ok("main.js's instant thunder clip is not played as well (one boom, at the speed of sound)", thunders === 0, `${thunders} thunder clips`);
  ok("the bomb's old sphere-and-ring is switched off, not drawn twice", legacy);
  const s = FX.explosionStats();
  ok('and leaves a scorch mark and debris', s.decals >= 1 && s.debris >= 5, JSON.stringify({ decals: s.decals, debris: s.debris }));

  // The bomb cam: it fell for eight seconds from well up, so the camera goes to it.
  const ext = hook('explosions');
  ok('your own bomb landing starts the bomb cam', s.bombCam === true);
  const cam = sim.camera;
  const owned = ext.camera(sim, 1 / 60, cam);
  const toBlast = cam.position.distanceTo(bomb.group.position);
  const look = V(0, 0, -1).applyQuaternion(cam.quaternion);
  const aim = bomb.group.position.clone().sub(cam.position).normalize();
  ok('the bomb cam owns the camera, a couple of hundred metres from the blast, looking at it', owned === true && toBlast > 80 && toBlast < 450 && look.dot(aim) > 0.9,
    `${Math.round(toBlast)} m away, aim ${look.dot(aim).toFixed(2)}`);
  // C is the game's camera key and on the do-not-take list: no key hook at
  // all. Changing the view, however it is done, is what skips the bomb cam.
  ok('no key is taken for the bomb cam', typeof ext.key !== 'function');
  sim.rig.initialised = true;
  sim.rig.mode = 'cockpit'; // what rig.cycle() does for C, the touch button or the pad
  const ownedAfter = ext.camera(sim, 1 / 60, cam);
  ok('changing the view skips the bomb cam that same frame, and the new view is left to start itself',
    ownedAfter === false && !FX.explosionStats().bombCam && sim.rig.initialised === true);
  sim.rig.mode = 'chase';
  bomb.dispose();
  sim.crate = null;
}

{
  // The bomb cam ends by itself, and never happens low down.
  const sim = makeSim();
  const ext = hook('explosions');
  sim.aircraft.pos.set(-600, 500, -100);
  const { bomb, after } = dropBomb(sim, -300, 0, 330, V(70, 0, 0));
  let frames = 0;
  while (ext.camera(sim, 1 / 60, sim.camera) && frames < 600) {
    frame(sim, 1 / 60, false);
    frames++;
  }
  const shown = (after + frames) / 60;
  ok(`the bomb cam hands the camera back ${FX.BOMB_CAM_SECONDS} s after the bang`, Math.abs(shown - FX.BOMB_CAM_SECONDS) < 2.5 / 60, `${shown.toFixed(3)} s`);
  bomb.dispose();
  sim.crate = null;

  // Another feature has the camera (so our camera hook is never called):
  // the bomb cam still ends on time and takes its label with it.
  const other = makeSim();
  other.aircraft.pos.set(-600, 500, -100);
  const r3 = dropBomb(other, -300, 0, 330, V(70, 0, 0));
  const startedCam = FX.explosionStats().bombCam;
  let n3 = 0;
  while (FX.explosionStats().bombCam && n3 < 600) {
    frame(other, 1 / 60, false);
    n3++;
  }
  const shown3 = (r3.after + n3) / 60;
  ok('with the camera owned elsewhere, the bomb cam still times out on its own clock', startedCam && Math.abs(shown3 - FX.BOMB_CAM_SECONDS) < 2.5 / 60,
    `${startedCam ? 'on' : 'never on'}, off after ${shown3.toFixed(3)} s`);
  r3.bomb.dispose();
  other.crate = null;
  const low = makeSim();
  low.aircraft.agl = 60;
  low.aircraft.pos.set(-600, 90, -100);
  const r2 = dropBomb(low, -300, 0, 330, V(70, 0, 0));
  ok('no bomb cam when the aeroplane is low (you need to be looking where you are going)', !FX.explosionStats().bombCam && r2.splashT !== null);
  r2.bomb.dispose();
  low.crate = null;
}

{
  const sim = makeSim();
  sim.aircraft.pos.set(2600, 500, 2900);
  FX.clearExplosions();
  const x = 3000;
  const z = 3000;
  const { bomb, splashT, t, thunders } = dropBomb(sim, x, z, 300, V(60, 0, 0));
  ok('over the sea it splashes AT the surface, before the store reaches the sea bed', splashT !== null && splashT < t - 0.2 && bomb.group.visible === false,
    `splash at ${splashT && splashT.toFixed(2)} s, store on the bottom at ${t.toFixed(2)} s`);
  ok('the range mission still sees the store arrive (landed)', bomb.landed === true);
  ok('and reaching the sea bed plays no thunder either', thunders === 0, `${thunders} thunder clips`);
  const sp = FX.explode(sim, V(-300, Terrain.heightAt(-300, 0), 0), { size: 1, kind: 'splash' });
  ok("kind 'splash' is a splash even on land (a water drop)", sp.water && !sp.air && Math.abs(sp.y - Terrain.heightAt(-300, 0)) < 1e-6);
  bomb.dispose();
  sim.crate = null;
}

{
  // Free flight in the bomber comes with the rack loaded — and only then.
  const sim = makeSim();
  const ext = hook('explosions');
  const armedIn = (type, mode = 'free') => {
    sim.aircraftType = type;
    sim._cargo = false;
    ext.startMode(sim, mode, {});
    return sim.hasCargo;
  };
  const nightjar = TYPES.AIRCRAFT.find((a) => a.id === 'nightjar');
  ok('free flight in the Nightjar (the real roster entry) is armed', !!nightjar && armedIn(nightjar) === true);
  ok('a mission in it is left to the mission', armedIn(nightjar, 'mission') === false);
  ok('civil types are not touched', armedIn({ id: 'skylark' }) === false && armedIn(TYPES.AIRCRAFT.find((a) => a.id === 'courier')) === false);
  // The fighters team's jets are military too; they are theirs to arm.
  ok("another team's military jet is left alone unless it asks", armedIn({ id: 'f22', military: true, stores: 2 }) === false
    && armedIn({ id: 'f22', military: true, stores: 2, freeFlightStores: true }) === true
    && armedIn({ id: 'nightjar', military: true, freeFlightStores: false }) === false);
  ok('every type the base roster arms is military (X drops a bomb, not a crate)',
    TYPES.AIRCRAFT.filter((a) => FX.rackInFreeFlight(a)).every((a) => a.military), TYPES.AIRCRAFT.filter((a) => FX.rackInFreeFlight(a)).map((a) => a.id).join(', '));
  sim._cargo = false;
}

{
  // A gentle one: what a meteor landing in town looks like.
  const sim = makeSim();
  sim.aircraft.pos.set(-900, 400, 0);
  setHeading(sim, 90, 0);
  FX.clearExplosions();
  const t0 = FX.explosionStats().thuds;
  const g = FX.explode(sim, V(-500, Terrain.heightAt(-500, 0), 0), { size: 2, kind: 'meteor', gentle: true });
  frame(sim, 1 / 60, false);
  const sg = FX.explosionStats();
  FX.clearExplosions();
  const hot = FX.explode(sim, V(-500, Terrain.heightAt(-500, 0), 0), { size: 2, kind: 'meteor' });
  frame(sim, 1 / 60, false);
  const sh = FX.explosionStats();
  ok('a gentle blast on land is a thud: dust, dirt, stars and a crater', g && g.gentle && sg.thuds === t0 + 1 && sg.decals >= 1 && sg.debris >= 5 && sg.smoke > 10,
    JSON.stringify({ decals: sg.decals, debris: sg.debris, smoke: sg.smoke }));
  ok('with far less fire and light than the same meteor landing in a field', sg.glow < sh.glow * 0.5 && sg.light < sh.light * 0.35,
    `glow ${sg.glow} vs ${sh.glow}, light ${Math.round(sg.light)} vs ${Math.round(sh.light)}`);
  FX.clearExplosions();
  FX.explode(sim, V(-500, Terrain.heightAt(-500, 0), 0), { size: 2, kind: 'meteor', gentle: true });
  run(sim, 6, 1 / 30);
  const after6 = FX.explosionStats().blasts;
  FX.clearExplosions();
  FX.explode(sim, V(-500, Terrain.heightAt(-500, 0), 0), { size: 2, kind: 'meteor' });
  run(sim, 6, 1 / 30);
  ok('and nothing keeps burning or smoking after it (a field landing still has its column)', !!hot && after6 === 0 && FX.explosionStats().blasts === 1,
    `after 6 s: gentle ${after6} blasts going, field ${FX.explosionStats().blasts}`);
  const wg = FX.explode(sim, V(3000, 3, 3000), { size: 2, kind: 'meteor', gentle: true });
  ok('gentle means nothing over the sea: a splash is a splash', wg && wg.water && !wg.gentle);
  FX.clearExplosions();
}

/*
 * Fill: what a GPU has to shade for the effects. Nobody here can time a
 * 2019 Chromebook's GPU, but the pixels it must fill can be counted: every
 * frame, the sum of the live billboards' on-screen quad areas (clipped to
 * the screen), in screens, using the shader's own fade and cut-off
 * (FX.FADE). A quad the shader moves off screen costs nothing.
 */
const FIRST_PASS_FADE = { near0: 0.35, near1: 1.4, cut: -Infinity }; // drew every quad
function particleFill(sim, fade = FX.FADE) {
  const cam = sim.camera;
  cam.updateMatrixWorld();
  const view = cam.matrixWorldInverse.copy(cam.matrixWorld).invert();
  const tanf = Math.tan((cam.fov * Math.PI) / 360);
  const { near0, near1, cut } = fade;
  const p = V();
  let screens = 0;
  for (const name of ['fx-glow', 'fx-smoke', 'fx-star']) {
    const mesh = findByName(sim.scene, name);
    if (!mesh) continue;
    const g = mesh.geometry;
    const P = g.attributes.iPos.array;
    const SR = g.attributes.iSR.array;
    const C = g.attributes.iCol.array;
    for (let i = 0; i < g.instanceCount; i++) {
      p.set(P[3 * i], P[3 * i + 1], P[3 * i + 2]).applyMatrix4(view);
      const z = -p.z;
      const s = SR[2 * i];
      if (z <= cam.near) continue;
      const t = Math.min(1, Math.max(0, (z - near0 * s) / ((near1 - near0) * s)));
      if (C[4 * i + 3] * t * t * (3 - 2 * t) < cut) continue;
      const hy = s / 2 / (z * tanf);
      const hx = hy / cam.aspect;
      const cx = p.x / (z * tanf * cam.aspect);
      const cy = p.y / (z * tanf);
      const w = Math.max(0, Math.min(1, cx + hx) - Math.max(-1, cx - hx));
      const h = Math.max(0, Math.min(1, cy + hy) - Math.max(-1, cy - hy));
      screens += (w * h) / 4;
    }
  }
  return screens;
}

{
  const sim = makeSim();
  const smoke = findByName(sim.scene, 'fx-smoke');
  const vs = smoke && smoke.material.vertexShader;
  ok('the shader fades and cuts with the FADE numbers the fill check uses',
    !!vs && vs.includes(`smoothstep(${FX.FADE.near0} * iSR.x, ${FX.FADE.near1} * iSR.x`) && vs.includes(`vCol.a < ${FX.FADE.cut})`));
  const ext = hook('explosions');
  // Your own bomb, watched through the bomb cam.
  sim.aircraft.pos.set(-600, 500, -100);
  const { bomb } = dropBomb(sim, -300, 0, 330, V(70, 0, 0));
  let camPeak = 0;
  for (let i = 0; i < 90; i++) {
    frame(sim, 1 / 30, false);
    if (ext.camera(sim, 1 / 30, sim.camera)) camPeak = Math.max(camPeak, particleFill(sim));
  }
  bomb.dispose();
  sim.crate = null;
  FX.clearExplosions();
  // Twenty in a row from the chase camera.
  sim.aircraft.pos.set(-2500, 350, 0);
  setHeading(sim, 90, 60);
  for (let i = 0; i < 20; i++) FX.scheduleExplosion(V(-2000 + i * 90, 0, 200), { size: 1 }, i * 0.2);
  let rowPeak = 0;
  run(sim, 8, 1 / 30, () => { rowPeak = Math.max(rowPeak, particleFill(sim)); });
  FX.clearExplosions();
  // Flying straight through a meteor blast 60 m up: the worst case there is.
  sim.aircraft.pos.set(-2500, 60, 0);
  setHeading(sim, 90, 60);
  FX.explode(sim, V(-2320, Terrain.heightAt(-2320, 0), 0), { size: 2, kind: 'meteor' });
  let thruPeak = 0;
  let thruSum = 0;
  let thruFirst = 0;
  run(sim, 8, 1 / 30, () => {
    const f = particleFill(sim);
    thruPeak = Math.max(thruPeak, f);
    thruSum += f;
    thruFirst += particleFill(sim, FIRST_PASS_FADE);
  });
  FX.clearExplosions();
  ok('the bomb cam fills under 3 screens of particle pixels at its busiest', camPeak > 0.2 && camPeak < 3, `peak ${camPeak.toFixed(2)} screens`);
  ok('twenty in a row, from the chase camera, under 2', rowPeak > 0.1 && rowPeak < 2, `peak ${rowPeak.toFixed(2)} screens`);
  /*
   * Against the first pass's fade on the very same frames, so the seed's
   * luck cancels out. A scratch copy of this flight over 300 seeds: now/first
   * 0.57-0.76 (median 0.66); the suite's own flight, after the bomb cam and
   * the twenty, runs a little higher: 0.67-0.77 in the runs looked at. A
   * revert of the cull reads 1.0. Peaks run 6.9-10.5 screens here; the first
   * pass's ran to 13.6.
   */
  ok('flying through a meteor blast shades at most 90% of the pixels the first pass did, and peaks under 14 screens',
    thruSum / thruFirst < 0.9 && thruPeak < 14,
    `${(100 * thruSum / thruFirst).toFixed(0)}% of the first pass's; peak ${thruPeak.toFixed(2)}, mean ${(thruSum / 240).toFixed(2)} screens (first pass mean ${(thruFirst / 240).toFixed(2)})`);
}

/* ------------------------------------------------------------------ */
/* Meteors                                                              */
/* ------------------------------------------------------------------ */

{
  const sim = makeSim();
  sim.meteors.begin({ mode: 'shower' }, null);
  const target = V(-200, Terrain.heightAt(-200, 40), 40);
  const m = sim.meteors.spawn({ target, az: 225, dive: 40, speed: 250, T: 10, radius: 2, size: 1.5 });
  const err = Math.hypot(m.impact.x - target.x, m.impact.z - target.z);
  // Read now: the pool hands this object to the next meteor once it lands.
  const predicted = m.impactT;
  ok('a meteor aimed at the airfield is predicted to land on it', m.hasImpact && err < 5, `off by ${err.toFixed(2)} m, lands in ${predicted.toFixed(2)} s`);
  let landedAt = null;
  run(sim, 12, 1 / 60, (i, t) => {
    if (landedAt === null && !m.active) landedAt = t;
  });
  ok('and lands when the prediction said', landedAt !== null && Math.abs(landedAt - predicted) < 0.1, `landed at ${landedAt && landedAt.toFixed(2)} s, predicted ${predicted.toFixed(2)} s`);
  const rocks = findByName(sim.scene, 'meteor-landed');
  ok('leaving its rock in the crater', rocks && rocks.count === 1);
  sim.meteors.end();
}

{
  // Meteor Shower: two minutes, and nothing ever comes through the aeroplane.
  const sim = makeSim();
  sim.meteors.begin({ mode: 'shower' }, 'meteor-shower');
  let closest = Infinity;
  let bigWarned = 0;
  let bigTooClose = 0;
  let warnLead = Infinity;
  const seen = new Set();
  // Burn-ups that happened where the chase camera could see them.
  let prevBurners = [];
  let burnSeen = 0;
  let burnAll = 0;
  const ndc = V();
  run(sim, 120, 1 / 30, (i) => {
    for (const m of prevBurners) {
      if (m.active) continue;
      burnAll++;
      ndc.copy(m.pos).project(sim.camera);
      if (ndc.z < 1 && Math.abs(ndc.x) < 1 && Math.abs(ndc.y) < 1) burnSeen++;
    }
    prevBurners = sim.meteors.meteors().filter((m) => m.kind === 'burner');
    if (i % 450 === 0) setHeading(sim, sim.aircraft.heading + 100);
    for (const m of sim.meteors.meteors()) {
      closest = Math.min(closest, m.pos.distanceTo(sim.aircraft.pos));
      if (m.big && !seen.has(m)) {
        seen.add(m);
        bigWarned += m.marker >= 0 ? 1 : 0;
        warnLead = Math.min(warnLead, m.impactT - m.t);
        const ac = sim.aircraft;
        const fx = ac.pos.x + ac.vel.x * (m.impactT - m.t);
        const fz = ac.pos.z + ac.vel.z * (m.impactT - m.t);
        if (Math.hypot(m.impact.x - fx, m.impact.z - fz) < 850) bigTooClose++;
      }
    }
  });
  const st = sim.meteors.stats;
  ok('two minutes of shower: plenty to watch', st.spawned > 40 && st.burned > 20 && st.landed > 5 && st.bigSeen >= 2, JSON.stringify({ spawned: st.spawned, burned: st.burned, landed: st.landed, big: st.bigSeen }));
  ok('no meteor ever comes within 150 m of the aeroplane in the shower', closest > 150, `closest ${Math.round(closest)} m`);
  // The first version spread them round the whole sky and up to 40 degrees
  // high; flown in the game, five in the air and none on the screen. Over
  // 200 seeds this measures 0.75 on the median run with about fifty
  // burn-ups each; the bar was 0.6, two and a half spreads under that, and
  // seed 167 came in at 31 of 52. Half is still nothing like none, and a
  // regression to the old placement cannot reach it.
  ok('at least half the burn-ups happen where the chase camera is looking', burnAll > 20 && burnSeen / burnAll >= 0.5, `${burnSeen} of ${burnAll} on screen`);
  ok('every big one gets a marker and at least 12 s of warning', bigWarned === seen.size && seen.size > 0 && warnLead >= 12, `${bigWarned}/${seen.size} marked, shortest warning ${warnLead.toFixed(1)} s`);
  ok('no big one is aimed where you will be', bigTooClose === 0, `${bigTooClose} too close`);
  ok('each big one is announced on screen', sim.notes.filter((n) => n.startsWith('Big meteor')).length >= seen.size);
  sim.meteors.end();
  ok('end() clears every meteor', sim.meteors.count() === 0 && !sim.meteors.active);
}

{
  // Stardust: a near burn-up leaves a cloud; flying into it collects it.
  const sim = makeSim();
  sim.meteors.begin({ mode: 'shower' }, null);
  const ac = sim.aircraft;
  const fwd = V(0, 0, -1).applyQuaternion(ac.quat);
  const at = ac.pos.clone().addScaledVector(fwd, 600);
  sim.meteors.spawn({ target: at, az: ac.heading + 90, dive: 30, speed: 250, T: 1, burn: true, stardust: true, radius: 1.5 });
  run(sim, 1.2, 1 / 60, () => {}, false);
  const dust = sim.meteors.nearestStardust();
  ok('a burn-up with stardust leaves a cloud where it burned', dust && dust.distanceTo(at) < 40, dust ? `${Math.round(dust.distanceTo(at))} m from the burn point` : 'none');
  ac.pos.copy(dust || at);
  frame(sim, 1 / 30, false);
  ok('flying into the cloud collects it', sim.meteors.stats.stardust === 1 && !sim.meteors.nearestStardust(), `stardust ${sim.meteors.stats.stardust}`);
  sim.meteors.end();
}

{
  // The zapper.
  const sim = makeSim();
  const key = hook('meteor').key;
  sim.meteors.begin({ mode: 'shower' }, null);
  const ac = sim.aircraft;
  const fwd = V(0, 0, -1).applyQuaternion(ac.quat);
  const ahead = ac.pos.clone().addScaledVector(fwd, 1500);
  ok('nothing ahead: the zap misses', sim.meteors.zap() === false);
  run(sim, 0.6, 1 / 30);
  const m = sim.meteors.spawn({ target: ahead, az: ac.heading + 180, dive: 5, speed: 150, T: 0.01, burn: false, radius: 3, size: 1.5 });
  m.pos.copy(ahead);
  const hit = sim.meteors.zap();
  ok('a meteor in front of the nose is zapped', hit && !m.active && sim.meteors.stats.zapped === 1);
  /*
   * A fresh session for the overhead check, with no time run. This used to
   * run another 0.6 s, which is exactly when the shower's first burner is
   * due (1.2 s in); burners are put within fifty degrees of the nose, and
   * one landing inside the 16-degree cone was zapped — the zapper working,
   * the test failing (the reviewer measured 37 of 400). begin() also resets
   * the zap cool-down, which is what the 0.6 s was waiting out.
   */
  sim.meteors.begin({ mode: 'shower' }, null);
  ok('a fresh session has nothing in the air', sim.meteors.count() === 0);
  const side = ac.pos.clone().add(V(0, 0, 0)).addScaledVector(V(0, 1, 0), 1200);
  const m2 = sim.meteors.spawn({ target: side, az: 0, dive: 5, speed: 100, T: 0.01, radius: 3 });
  m2.pos.copy(side);
  ok('one straight overhead is not (you have to point at it)', sim.meteors.zap() === false && m2.active);
  ok('Z is taken by the zapper in the shower', key(sim, 'KeyZ', true, { repeat: false }) === true);
  sim.meteors.begin({ mode: 'dodge' }, null);
  ok('Z is left alone in Rock Dodger, which has no zapper', key(sim, 'KeyZ', true, { repeat: false }) === false && sim.meteors.zap() === false);
  ok('other keys are never taken', key(sim, 'KeyX', true, {}) === false);
  sim.meteors.end();
}

{
  // Rock Dodger: rocks are aimed at where you will be.
  const sim = makeSim();
  sim.aircraft.pos.set(-600, 700, 4200);
  setHeading(sim, 90);
  sim.meteors.begin({ mode: 'dodge' }, null);
  /*
   * How close each rock comes to you if you both keep going: the closest
   * approach of two straight lines in time. The old check measured the
   * rock's line against where you would be when it passed your HEIGHT, but
   * the aim offset is perpendicular to the rock's path and so partly
   * vertical: the rock reaches your height up to half a second off, you
   * have moved 30 m by then, and the "miss" grew to 126 m (11 over 120 m in
   * 3,000 spawns, the reviewer's count) for rocks aimed within 100 m. Both
   * moving, the gap at the aimed moment IS the aim offset, so this bound is
   * exact, and 400 rocks a run sample it properly.
   */
  let worst = 0;
  let straightAt = 0;
  const N_ROCKS = 400;
  const r0 = V();
  const dv = V();
  for (let k = 0; k < N_ROCKS; k++) {
    const ac = sim.aircraft;
    const m = sim.meteors.spawnThreat(0.5);
    r0.subVectors(m.pos, ac.pos);
    dv.copy(m.vel).sub(ac.vel);
    const t = Math.max(0, -r0.dot(dv) / dv.lengthSq());
    const miss = r0.addScaledVector(dv, t).length();
    worst = Math.max(worst, miss);
    if (miss < m.radius + 9) straightAt++;
    sim.meteors.end();
    sim.meteors.begin({ mode: 'dodge' }, null);
  }
  ok(`every dodge rock (${N_ROCKS} of them) passes within 100 m of you if you fly straight`, worst < 100.5, `widest miss ${worst.toFixed(1)} m`);
  // Half way through, 30% are aimed dead on (0-8 m) and would bonk you.
  ok('and about a third of them would actually hit', straightAt > N_ROCKS * 0.2 && straightAt < N_ROCKS * 0.42, `${straightAt} of ${N_ROCKS} within bonk range`);

  sim.meteors.begin({ mode: 'dodge' }, null);
  run(sim, 120, 1 / 30);
  const st = sim.meteors.stats;
  ok('fly dead straight and you get bonked', st.hits >= 1 && st.shields === 3 - st.hits, `hits ${st.hits}, shields ${st.shields}, close shaves ${st.nearMisses}`);
  ok('a bonk is a shield and a notice, never a crash', sim.notes.some((n) => n.startsWith('BONK')) && !sim.aircraft.crashed);
}

{
  // Rock Dodger through the real mission runner: survive and it completes;
  // lose the shields and it fails with the friendly reason.
  const def = ALL.findMission('meteor-dodge');
  const sim = makeSim();
  sim.aircraft.pos.set(-600, 700, 4200);
  setHeading(sim, 90);
  sim.runner.start(def);
  ok('starting the mission starts dodge mode', sim.meteors.active && sim.meteors.mode === 'dodge');
  run(sim, 5, 1 / 30, () => sim.runner.update(1 / 30));
  sim.meteors.stats.elapsed = 179.5;
  sim.meteors.stats.shields = 3;
  run(sim, 1, 1 / 30, () => sim.runner.update(1 / 30));
  ok('three minutes survived completes Rock Dodger', sim.runner.status === 'complete', `${sim.runner.status}, score ${sim.runner.data.score}`);

  const sim2 = makeSim();
  let failed = null;
  sim2.runner.onFail = (f) => { failed = f.reason; };
  sim2.runner.start(def);
  run(sim2, 2, 1 / 30, () => sim2.runner.update(1 / 30));
  sim2.meteors.stats.shields = 0;
  sim2.runner.update(1 / 30);
  ok('out of shields fails it, kindly', sim2.runner.status === 'failed' && /shields/i.test(failed || ''), failed);
}

{
  // Guard the Town.
  const def = ALL.findMission('meteor-town');
  const sim = makeSim();
  const tp = def.spawn.pos;
  sim.aircraft.pos.set(tp.x, 820, tp.z);
  // Holding station over the town (speed 0), so every rock comes to it.
  setHeading(sim, 45, 0);
  sim.runner.start(def);
  const sched = sim.meteors.schedule();
  const town = sim.meteors.town();
  const inTown = sched.every((e) => Math.hypot(e.x - town.x, e.z - town.z) < town.r * 0.75);
  const fromNE = sched.every((e) => {
    const from = ((e.az - 180) % 360 + 360) % 360;
    return from >= 5 && from <= 85;
  });
  ok('sixteen rocks, all aimed inside the town, all from the north-east', sched.length === 16 && inTown && fromNE);
  // A perfect pilot: nose on the nearest rock, zap it.
  let zaps = 0;
  run(sim, 200, 1 / 30, (i) => {
    sim.runner.update(1 / 30);
    const p = sim.meteors.nearestTownRock();
    if (p && i % 6 === 0) {
      const ac = sim.aircraft;
      ac.quat.setFromRotationMatrix(new THREE.Matrix4().lookAt(ac.pos, p, V(0, 1, 0)));
      if (sim.meteors.zap()) zaps++;
    }
  });
  const st = sim.meteors.stats;
  ok('zap every one and the town is untouched and the mission completes', st.landedTown === 0 && st.townZapped === 16 && sim.runner.status === 'complete',
    `town rocks zapped ${st.townZapped} (all zaps ${zaps}), in town ${st.landedTown}, status ${sim.runner.status}, score ${sim.runner.data.score}`);
  ok('only town rocks count towards the town score', sim.runner.data.score === 100 && st.zapped >= st.townZapped, `score ${sim.runner.data.score}`);

  const sim2 = makeSim();
  let failed = null;
  sim2.runner.onFail = (f) => { failed = f.reason; };
  sim2.aircraft.pos.set(tp.x, 820, tp.z);
  setHeading(sim2, 45, 0);
  sim2.runner.start(def);
  const thuds0 = FX.explosionStats().thuds;
  run(sim2, 200, 1 / 30, () => sim2.runner.status === 'running' && sim2.runner.update(1 / 30));
  ok('zap none and five in town fails it', sim2.runner.status === 'failed' && sim2.meteors.stats.landedTown >= 5 && /town/i.test(failed || ''), failed);
  // Every one that came down on the town's land was a thud, not a fireball.
  const onLand = sim2.meteors.schedule().filter((e) => Terrain.heightAt(e.x, e.z) > 0).length;
  const thuds = FX.explosionStats().thuds - thuds0;
  ok('rocks that land in town go thud (dust and stars), never a fireball', sim2.meteors.stats.landedTown === 16 && thuds === onLand && onLand > 0,
    `${sim2.meteors.stats.landedTown} landed in town, ${onLand} of them on land, ${thuds} thuds`);
}

{
  // Nothing in the shower is aimed through you: every lander, big one and
  // burner, over hundreds of spawns, keeps its distance from where you will
  // be (flying straight at 62 m/s) all the way down.
  const sim = makeSim();
  sim.aircraft.pos.set(-2600, 650, 1400);
  let worstL = Infinity;
  let worstB = Infinity;
  let worstBurn = Infinity;
  let made = 0;
  const r0 = V();
  const dv = V();
  const gap = (m, T) => {
    const ac = sim.aircraft;
    r0.subVectors(m.pos, ac.pos);
    dv.copy(m.vel).sub(ac.vel);
    const t = Math.min(T, Math.max(0, -r0.dot(dv) / dv.lengthSq()));
    return r0.addScaledVector(dv, t).length();
  };
  for (let k = 0; k < 600; k++) {
    setHeading(sim, (k * 37) % 360);
    sim.meteors.begin({ mode: 'shower' }, null);
    const kind = k % 3;
    const m = kind === 0 ? sim.meteors.spawnLander(true) : kind === 1 ? sim.meteors.spawnLander(false) : sim.meteors.spawnBurner(k % 2 === 0);
    if (!m) continue;
    made++;
    const T = m.hasImpact ? m.impactT : (m.pos.y - m.burnY) / (m.speed * -m.dir.y);
    const g = gap(m, T);
    if (kind === 0) worstB = Math.min(worstB, g);
    else if (kind === 1) worstL = Math.min(worstL, g);
    else worstBurn = Math.min(worstBurn, g);
  }
  sim.meteors.end();
  ok('no shower meteor\'s path comes near yours (600 spawns): big ones 450 m, landers 300 m, burners 350 m',
    made > 450 && worstB >= 449 && worstL >= 299 && worstBurn >= 349,
    `${made} made; closest big ${Math.round(worstB)} m, lander ${Math.round(worstL)} m, burner ${Math.round(worstBurn)} m`);
}

{
  // The shower's own landers keep out of the town, even flying straight at it.
  const sim = makeSim();
  const town = sim.meteors.town();
  sim.aircraft.pos.set(town.x - 2400, 700, town.z);
  setHeading(sim, 90);
  let inTownN = 0;
  let made = 0;
  for (let k = 0; k < 300; k++) {
    sim.meteors.begin({ mode: 'shower' }, null);
    const m = sim.meteors.spawnLander(k % 3 === 0);
    if (!m || !m.hasImpact) continue;
    made++;
    if (Math.hypot(m.impact.x - town.x, m.impact.z - town.z) < town.r * 1.1) inTownN++;
  }
  sim.meteors.end();
  ok('no shower meteor is aimed at the town (300 tries, heading straight for it)', made > 150 && inTownN === 0, `${made} made, ${inTownN} in town`);
}

{
  // Photograph the Big One.
  const def = ALL.findMission('meteor-photo');
  const sim = makeSim();
  const sp = def.spawn;
  sim.aircraft.pos.set(sp.pos.x, 750, sp.pos.z);
  setHeading(sim, sp.headingDeg);
  sim.runner.start(def);
  run(sim, 8, 1 / 30, () => sim.runner.update(1 / 30));
  const g = sim.meteors.giantPos();
  const giant = sim.meteors.meteors().find((m) => m.giant);
  ok('the giant arrives on cue and is heading for the sea', !!g && giant && giant.hasImpact && giant.water, giant ? `impact in ${Math.round(giant.impactT)} s, water ${giant.water}` : 'no giant');
  ok('the HUD arrow points at it', sim.runner.activeTarget() && sim.runner.activeTarget().pos === g);
  // Fly up to it, 1.2 km behind it along its path, nose on it.
  const ac = sim.aircraft;
  run(sim, 2, 1 / 30, () => {
    ac.pos.copy(giant.pos).addScaledVector(giant.dir, -1200);
    ac.quat.setFromRotationMatrix(new THREE.Matrix4().lookAt(ac.pos, giant.pos, V(0, 1, 0)));
    ac.vel.set(0, 0, 0);
    sim.runner.update(1 / 30);
  });
  const st = sim.meteors.stats;
  ok('hold it in the frame and the photo is taken', st.photoTaken && st.photoQuality >= 40 && st.photoQuality <= 100, `quality ${st.photoQuality}%, ${st.photoDistance} m`);
  ok('zapping the giant does nothing but say so', sim.meteors.zap() === false && giant.active);
  run(sim, 120, 1 / 30, () => sim.runner.status === 'running' && sim.runner.update(1 / 30));
  ok('then it splashes down and the mission completes', st.giantLanded && sim.runner.status === 'complete', `${sim.runner.status}, score ${sim.runner.data.score}`);

  const sim2 = makeSim();
  let failed = null;
  sim2.runner.onFail = (f) => { failed = f.reason; };
  sim2.aircraft.pos.set(sp.pos.x, 750, sp.pos.z);
  setHeading(sim2, sp.headingDeg + 180);
  sim2.runner.start(def);
  run(sim2, 130, 1 / 30, () => sim2.runner.status === 'running' && sim2.runner.update(1 / 30));
  ok('miss the picture and it fails with a hint, not a scolding', sim2.runner.status === 'failed' && /sooner/.test(failed || ''), failed);
}

{
  // Cost of a busy shower, per frame, including every particle.
  const sim = makeSim();
  sim.meteors.begin({ mode: 'shower' }, null);
  run(sim, 5, 1 / 30);
  const n = 30 * 60;
  const times = new Float64Array(n);
  run(sim, 60, 1 / 30, (i) => {
    if (i % 300 === 0) sim.meteors.spawnLander(true);
  });
  for (let i = 0; i < n; i++) {
    const t0 = performance.now();
    frame(sim, 1 / 30);
    times[i] = performance.now() - t0;
  }
  ok('a minute of heavy shower costs under 1.5 ms a frame here (median frame)', median(times) < 1.5, `median ${median(times).toFixed(3)} ms, 90th ${pct(times, 0.9).toFixed(3)} ms`);
  sim.meteors.end();
}

{
  // The stop hook clears the lot; a non-meteor flight ends a session.
  const sim = makeSim();
  sim.meteors.begin({ mode: 'shower' }, null);
  run(sim, 20, 1 / 30);
  hook('meteor').stop(sim, 'menu');
  hook('explosions').stop(sim, 'menu');
  const s = FX.explosionStats();
  ok('stop() clears meteors and every effect', !sim.meteors.active && sim.meteors.count() === 0 && s.blasts === 0 && s.glow === 0 && s.smoke === 0);
  sim.meteors.begin({ mode: 'shower' }, null);
  sim.runner.def = { id: 'circuit', steps: [] };
  hook('meteor').startMode(sim, 'mission', { id: 'circuit' });
  ok('starting any other flight ends the shower', !sim.meteors.active);
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} weapons checks passed`);
if (failed.length) {
  for (const f of failed) console.log(`  FAILED: ${f.name} ${f.detail}`);
  process.exit(1);
}

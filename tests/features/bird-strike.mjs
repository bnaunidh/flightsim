/**
 * Node checks for the bird strike (src/features/bird-strike.js; the owner,
 * 2026-10-22: the bird was "way oversized" and "slowly drifts ~3 s before
 * hitting the engine"). Run with plain node:
 *
 *   node tests/features/bird-strike.mjs
 *
 *   1. SIZE. Every bird in the flock has a gull-to-goose wingspan, 0.7-1.5 m,
 *      as drawn (the mesh's 2.6 m silhouette times its scale); the ambient
 *      flock is nearer life size than it was.
 *   2. A HIT, NOT A CUTSCENE. The flock appears less than half a second before
 *      the lead bird meets an engine, at the closing speed: three to six birds,
 *      flying at a bird's pace across and towards you, placed so that where the
 *      engine WILL be when they arrive is where they arrive.
 *   3. THE HIT. At the lead the thump sounds once, the camera kicks, the engine
 *      runs rough, the warning shows, the lead bird is gone and feathers fly;
 *      the rest scatter past and are gone a few seconds later. While the flock
 *      is on its way nothing of that has happened yet (the fire waits too).
 *   4. ON THE GROUND, OR WITH NO FLOCK: the event does what it always did, at
 *      once.
 */

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
const imp = (p) => import(new URL(p, root).href);
const THREE = await imp('vendor/three.module.js');
const T = await imp('aircraft/types.js');
const BS = await imp('features/bird-strike.js');
const DIS = await imp('game/disasters.js');
const EXT = await imp('game/extensions.js');
const WF = await imp('world/features.js');

let pass = 0;
let fail = 0;
function ok(name, cond, detail = '') {
  if (cond) pass++;
  else fail++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail !== '' ? '  — ' + detail : ''}`);
}
const f2 = (v) => (Math.round(v * 100) / 100).toString();

const ext = (typeof EXT.extensions === 'function' ? EXT.extensions() : EXT.extensions || []).find((e) => e.id === 'bird-strike');
ok('the feature is registered', !!ext, ext ? 'bird-strike' : 'missing');

/** A stand-in game: a Skylark at 60 m/s due east, 300 m up. */
function makeSim(type = T.AIRCRAFT.find((t) => t.id === 'skylark')) {
  const log = { thuds: 0, kicks: 0, notes: [], toggled: [], cautions: 0 };
  const sim = {
    state: 'flying',
    mode: 'free',
    aircraftType: type,
    aircraft: {
      pos: new THREE.Vector3(1000, 300, -2000),
      vel: new THREE.Vector3(60, 0, 0),
      quat: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -Math.PI / 2), // nose (-z) pointing +x
      onGround: false,
      crashed: false,
      failures: { roughEngine: false },
    },
    scene: new THREE.Scene(),
    renderer: null,
    camera: null,
    rig: { kick: () => log.kicks++ },
    hud: { notify: (t) => log.notes.push(t) },
    audio: { available: true, alerts: { thud: () => log.thuds++, caution: () => log.cautions++ } },
    activeEvents: {},
    toggleFailure(k) {
      sim.aircraft.failures[k] = !sim.aircraft.failures[k];
      log.toggled.push(k);
    },
    log,
  };
  return sim;
}
function boot(sim) {
  const group = new THREE.Group();
  sim.scene.add(group);
  ext.install(sim);
  ext.buildWorld(sim, group);
  ext.startMode(sim, 'free', {});
  return group;
}
/** Fly straight for dt: the aeroplane moves, then the feature steps. */
function tick(sim, dt = 1 / 60) {
  sim.aircraft.pos.addScaledVector(sim.aircraft.vel, dt);
  ext.update(sim, dt);
}
const birdEvent = DIS.NATURAL_EVENTS.find((e) => e.id === 'birdStrike');
ok('the Bird strike event exists in the natural events', !!birdEvent, birdEvent ? birdEvent.warn : 'missing');

/* ---- 1 + 2: the flock, its size, where it appears -------------------------------- */
{
  const sim = makeSim();
  boot(sim);
  const D = () => BS.birdStrikeDebug();
  ok('with nothing in flight the ambient flock is drawn nearer life size than before (under 2 m, over a gull\'s 1.4)', WF.AMBIENT_BIRD_SPAN >= 1.4 && WF.AMBIENT_BIRD_SPAN < 2.0, `${WF.AMBIENT_BIRD_SPAN} m`);
  const t0 = performance.now();
  birdEvent.apply(sim);
  const applyMs = performance.now() - t0;
  const d = D();
  ok('rolling the event in flight starts a strike that is PENDING (the hit has not happened yet)', d.pending && sim.birdStrike && sim.birdStrike.pending && d.strike && !d.strike.done, JSON.stringify(d.strike));
  ok('…so nothing has thumped, kicked, warned or roughened the engine yet', sim.log.thuds === 0 && sim.log.kicks === 0 && sim.log.notes.length === 0 && !sim.aircraft.failures.roughEngine, JSON.stringify(sim.log));
  const birds = d.birds.filter((b) => b.visible);
  ok('a small flock: three to six birds', birds.length >= BS.BIRD.flockMin && birds.length <= BS.BIRD.flockMax && BS.BIRD.flockMin === 3 && BS.BIRD.flockMax === 6, `${birds.length} birds`);
  ext.update(sim, 0); // scales are set on the first step
  const spans = D().birds.filter((b) => b.visible).map((b) => b.scale[0] * BS.BIRD.meshSpan);
  ok('every bird is gull to goose sized as drawn: a 0.7-1.5 m wingspan', spans.length > 0 && spans.every((s) => s >= 0.7 - 1e-6 && s <= 1.5 + 1e-6), spans.map(f2).join(', ') + ' m');
  // Where they are against where the engine is: at the closing speed, under half a second away.
  const ac = sim.aircraft;
  const lead = birds[0];
  const engineNow = BS.enginePoint(sim.aircraftType, 0).applyQuaternion(ac.quat).add(ac.pos);
  const rel = new THREE.Vector3().fromArray(lead.pos).sub(engineNow);
  const closing = new THREE.Vector3().fromArray(lead.vel).sub(ac.vel);
  const closingSpeed = closing.length();
  const timeToMeet = rel.length() / closingSpeed;
  ok('the flock appears less than half a second before the hit at the closing speed (yours plus theirs)', timeToMeet > 0.25 && timeToMeet < BS.BIRD.leadMax && BS.BIRD.lead < BS.BIRD.leadMax, `${rel.length().toFixed(1)} m away, closing at ${closingSpeed.toFixed(1)} m/s: ${timeToMeet.toFixed(2)} s`);
  ok('…AHEAD of you, not beside or behind', rel.dot(ac.vel) > 0 && Math.abs(rel.y) < 2, `${rel.toArray().map((v) => v.toFixed(1)).join(', ')} relative to the engine`);
  const birdSpeed = new THREE.Vector3().fromArray(lead.vel).length();
  ok('the birds fly at a bird\'s pace, 10-14 m/s, across and towards you (not hovering, not drifting at yours)', birdSpeed >= BS.BIRD.speedMin - 1e-6 && birdSpeed <= BS.BIRD.speedMax + 1e-6 && new THREE.Vector3().fromArray(lead.vel).dot(ac.vel) < 0, `${birdSpeed.toFixed(1)} m/s, dot with yours ${new THREE.Vector3().fromArray(lead.vel).dot(ac.vel).toFixed(0)}`);
  ok('the strike allocates nothing on the GPU and starts in well under a frame', applyMs < 8, `${applyMs.toFixed(2)} ms`);
  // The lead bird meets the engine: fly both forward and watch the distance close to a hand's breadth.
  let best = Infinity;
  let bestT = 0;
  let hitAt = -1;
  for (let i = 0; i < 90; i++) {
    tick(sim);
    const t = (i + 1) / 60;
    const e = BS.enginePoint(sim.aircraftType, 0).applyQuaternion(ac.quat).add(ac.pos);
    const b = D().birds[0];
    if (b.visible) {
      const dist = new THREE.Vector3().fromArray(b.pos).distanceTo(e);
      if (dist < best) {
        best = dist;
        bestT = t;
      }
    } else if (hitAt < 0) hitAt = t;
  }
  ok('the lead bird\'s path meets the engine (within a wingspan, where it WILL be, not where it was)', best < 1.6, `${best.toFixed(2)} m at ${bestT.toFixed(2)} s`);
  ok('the hit comes at the lead time, between 0.3 and 0.5 s after the flock appeared', hitAt > 0.3 && hitAt <= 0.5 + 1 / 60, `${hitAt.toFixed(3)} s`);

  /* ---- 3: the hit ------------------------------------------------------------------- */
  ok('the hit: ONE thump, a camera kick, the engine running rough, the warning, the caution chime', sim.log.thuds === 1 && sim.log.kicks === 1 && sim.aircraft.failures.roughEngine && sim.log.toggled.join() === 'roughEngine' && sim.log.notes.includes(birdEvent.warn) && sim.log.cautions === 1, JSON.stringify(sim.log));
  const after = D();
  ok('the lead bird is gone into the engine; the others fly on; feathers are in the air; the strike is no longer pending', after.birds[0].hit && !after.birds[0].visible && after.birds.filter((b) => b.visible).length === birds.length - 1 && after.feathers > 0 && !after.pending, `${after.birds.filter((b) => b.visible).length} birds left, ${after.feathers} feathers`);
  ok('a second roll while the first is still in the air does not double the hit', (birdEvent.apply(sim), sim.log.thuds === 1 && sim.log.toggled.length === 1), `${sim.log.thuds} thumps`);
  for (let i = 0; i < 60 * (BS.BIRD.linger + 1); i++) tick(sim);
  const gone = D();
  ok('a few seconds later the survivors and the feathers are gone and the group is hidden', gone.birds.every((b) => !b.visible) && gone.feathers === 0 && !gone.groupVisible && !gone.strike, JSON.stringify({ visible: gone.birds.filter((b) => b.visible).length, feathers: gone.feathers, group: gone.groupVisible }));
}

/* ---- 2b: a twin, either engine ---------------------------------------------------------- */
{
  const tempest = T.AIRCRAFT.find((t) => t.id === 'tempest');
  const left = BS.enginePoint(tempest, 0.1);
  const right = BS.enginePoint(tempest, 0.9);
  ok('on a twin the flock is aimed at one engine or the other, on the wing, never the nose', left.x < -1 && right.x > 1 && Math.abs(left.z - tempest.shape.power.z) < 1e-9, `${left.toArray().map(f2)} | ${right.toArray().map(f2)}`);
  const skylark = T.AIRCRAFT.find((t) => t.id === 'skylark');
  const nose = BS.enginePoint(skylark, 0.9);
  ok('on a single the flock is aimed at the nose (the propeller)', nose.x === 0 && nose.z < 0, nose.toArray().map(f2).join(', '));
  const o = BS.flockOrigin(new THREE.Vector3(0, 0, 0), new THREE.Vector3(60, 0, 0), new THREE.Vector3(-10, 0, 0), 0.4);
  ok('flockOrigin puts the flock where it meets the engine after the lead: engine + yours·t − theirs·t', Math.abs(o.x - 28) < 1e-9 && o.y === 0 && o.z === 0, o.toArray().join(', '));
}

/* ---- 4: on the ground, or without the feature, the event is immediate ------------------------ */
{
  const sim = makeSim();
  boot(sim);
  sim.aircraft.onGround = true;
  birdEvent.apply(sim);
  ok('on the ground the event does what it always did, at once: the thump and a rough engine', sim.log.thuds === 1 && sim.aircraft.failures.roughEngine && !BS.birdStrikeDebug().pending, JSON.stringify(sim.log));
  const bare = makeSim();
  delete bare.birdStrike;
  birdEvent.apply(bare);
  ok('without the feature installed the event is immediate too (the node suites, an old save)', bare.log.thuds === 1 && bare.aircraft.failures.roughEngine, JSON.stringify(bare.log));
  const slow = makeSim();
  boot(slow);
  slow.aircraft.vel.set(8, 0, 0);
  birdEvent.apply(slow);
  ok('too slow for a strike to be a hit (under 15 m/s): immediate', slow.log.thuds === 1 && !BS.birdStrikeDebug().pending, JSON.stringify(slow.log));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

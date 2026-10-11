/**
 * Node checks for the emergency scene (src/features/emergency-scene.js):
 *
 *   node tests/features/emergency-scene.mjs
 *
 * No page. The real worlds of Harrier Flats (the Big Burn's) and Gateway
 * (the hijacks') are built with a stub scene, and a scene is raised on each:
 *
 *   1. THE CONTRACT: raiseScene gives a handle with update(), dispose() and
 *      state(); sceneState() lists it; clearScene removes it; an `at` that is
 *      a function returning null leaves the scene pending until it answers;
 *      the extension's stop('airport') ("Return to the airfield") keeps a
 *      scene a feature raised and takes a mission's declared one down, to
 *      come back with its step; stop('menu') takes everything down.
 *   2. PLACEMENT: every crew vehicle is on dry ground, outside the ring,
 *      never on a runway strip (margin RUNWAY_MARGIN), never inside a
 *      keepClear circle, never in the water; every helicopter orbits 500 m or
 *      more off at 150 m AGL or more (300 with heliMinAgl), as a sky body of
 *      kind npc with rotor:true.
 *   3. THE LIGHT BARS: with Reduce flashing on, beaconLevels() is one soft
 *      pulse a second per side, no step between samples over 2% of full, no
 *      brighter than CAPS.strobe; with it off, 1.25 flashes a second per side,
 *      never more than three in any second, never two closer than
 *      MIN_FLASH_GAP.
 *   4. THE PIN: appended to an existing sim.mapPins, never replacing it, and
 *      removed on dispose with the others left alone; a missing list is made
 *      and taken away again.
 *   5. THE AMBIENT THINNING: thinAround is asked for three times the radius
 *      and undone on dispose.
 *   6. THE MISSIONS' OWN SCENES: the Big Burn's and both hijacks' `scenes`
 *      entries resolve, on their maps, to scenes that keep every rule.
 *
 * Exits 1 if anything fails.
 */

globalThis.document = globalThis.document || {
  createElement: () => ({
    getContext: () => new Proxy({}, { get: () => () => ({ addColorStop() {}, data: new Uint8ClampedArray(4) }) }),
    width: 0,
    height: 0,
    style: {},
  }),
  body: { appendChild() {} },
  head: { appendChild() {} },
};
globalThis.window = globalThis.window || { addEventListener() {}, devicePixelRatio: 1 };

const src = new URL('../../src/', import.meta.url).href;
const THREE = await import(src + 'vendor/three.module.js');
const TR = await import(src + 'world/terrain.js');
const AP = await import(src + 'world/airport.js');
const APR = await import(src + 'world/apron.js');
const PD = await import(src + 'world/pads.js');
const FS = await import(src + 'render/flash-safety.js');
const SKY = await import(src + 'features/sky.js');
const ES = await import(src + 'features/emergency-scene.js');
const MD = await import(src + 'features/emergency-scene/models.js');
const FIRE = await import(src + 'game/extra/fire.js');
const EV = await import(src + 'game/extra/events.js');

let passed = 0;
let failed = 0;
const fails = [];
function ok(name, pass, detail = '') {
  if (pass) passed++;
  else {
    failed++;
    fails.push(`${name}${detail ? ` — ${detail}` : ''}`);
  }
  console.log(`${pass ? 'ok  ' : 'FAIL'} ${name}${detail !== '' ? ` — ${detail}` : ''}`);
}

function loadMap(id) {
  TR.applyMap(id);
  AP.refreshRunways();
  APR.refreshApronElevation();
  TR.clearObstacles();
  TR.clearPlatforms();
  const scene = { add() {} };
  new AP.Airport(scene);
  new APR.Apron(scene, 'high');
  PD.buildPads(new THREE.Group());
}

/** A game-shaped object with what the scene reads. */
function makeSim({ pins = [{ x: 0, z: 0, label: 'somebody else\'s pin' }], player = { x: -8000, y: 400, z: 8000 } } = {}) {
  const sim = {
    scene: new THREE.Scene(),
    aircraft: { pos: new THREE.Vector3(player.x, player.y, player.z), vel: new THREE.Vector3(60, 0, 0), onGround: false },
    weather: null,
    mapPins: pins,
    roads: { list: [] },
    mode: 'mission',
    ambient: {
      thinned: [],
      thinAround(x, z, r) {
        const h = { x, z, r };
        this.thinned.push(h);
        return h;
      },
      unthin(h) {
        const i = this.thinned.indexOf(h);
        if (i >= 0) this.thinned.splice(i, 1);
      },
    },
  };
  return sim;
}

/** Every rule a built scene must keep, as failures. */
function audit(sc, keepClear = []) {
  const bad = [];
  for (const v of sc.vehicles) {
    if (!(TR.heightAt(v.x, v.z) > 1.5)) bad.push(`${v.kind} in the water at (${v.x | 0}, ${v.z | 0})`);
    if (TR.isOnAnyRunway(v.x, v.z, 10)) bad.push(`${v.kind} on a runway at (${v.x | 0}, ${v.z | 0})`);
    if (Math.hypot(v.x - sc.at.x, v.z - sc.at.z) < sc.radius) bad.push(`${v.kind} inside the ring`);
    for (const k of keepClear) if (Math.hypot(v.x - k.x, v.z - k.z) < k.r) bad.push(`${v.kind} inside keepClear (${k.x}, ${k.z})`);
  }
  for (const h of sc.helis) {
    if (h.r < 500) bad.push(`${h.role} heli orbit radius ${h.r}`);
    if (h.agl < 150) bad.push(`${h.role} heli at ${h.agl} m AGL`);
  }
  return bad;
}

/* ------------------------------------------------------------------ */
/* 1 + 2 + 4 + 5. A fire scene on Harrier Flats                         */
/* ------------------------------------------------------------------ */

loadMap('meadow');
{
  const sim = makeSim();
  const keep = [{ x: 3621, z: -2653, r: 480 }, { x: 2000, z: -1800, r: 620 }];
  const h = ES.raiseScene(sim, { at: { x: 1700, z: -1110 }, kind: 'fire', radius: 200, roads: true, cordon: 'town', crews: { fire: 3, ambulance: 2, police: 3 }, helis: { news: 1, police: 1, fire: 1 }, keepClear: keep, avoidRunway: true, label: 'Fire scene' });
  ok('contract: raiseScene returns a handle with update, dispose and state', h && typeof h.update === 'function' && typeof h.dispose === 'function' && typeof h.state === 'function');
  ok('contract: the scene is built at once when `at` is a point', !h.pending && h.state().built);
  ok('contract: sceneState() lists it', ES.sceneState().scenes.some((s) => s.id === h.id));
  const st = h.state();
  ok('fire scene: every crew asked for is staged (3 fire, 2 ambulance, 3 police)', st.staged.fire === 3 && st.staged.ambulance === 2 && st.staged.police === 3, JSON.stringify(st.staged));
  ok('fire scene: police cars on the town\'s street ends facing the fire', st.cordonCars >= 1, `${st.cordonCars}`);
  const bad = audit(st, keep);
  ok('fire scene: nothing on a runway, in keepClear or in the water; helicopters 500 m off and 150 m up', bad.length === 0, bad.join('; '));
  ok('fire scene: three helicopters, the bucket one among them', st.helis.length === 3 && st.helis.some((q) => q.role === 'bucket'), st.helis.map((q) => q.role).join(','));
  const bodies = SKY.bodies().filter((b) => !b.gone && /^scene-/.test(b.id));
  ok('fire scene: each helicopter is a sky body of kind npc with rotor:true', bodies.length === 3 && bodies.every((b) => b.kind === 'npc' && b.rotor === true), `${bodies.length}`);
  ok('pin: appended to sim.mapPins, the other pin kept', sim.mapPins.length === 2 && sim.mapPins[0].label === 'somebody else\'s pin' && sim.mapPins[1].label === 'Fire scene');
  ok('thinning: the ambient layer is asked to thin three times the radius', sim.ambient.thinned.length === 1 && sim.ambient.thinned[0].r === 600);
  // A few frames: the helicopters fly, nobody under their floor.
  for (let i = 0; i < 300; i++) h.update(0.1);
  const after = h.state();
  ok('fire scene: after 30 s the helicopters are still 150 m up and 500 m off', after.helis.every((q) => q.y - Math.max(0, TR.heightAt(q.x, q.z)) >= 149 && Math.hypot(q.x - after.at.x, q.z - after.at.z) > 400), after.helis.map((q) => `${q.role} ${Math.round(q.y - Math.max(0, TR.heightAt(q.x, q.z)))} m`).join(', '));
  ES.clearScene(sim, h);
  ok('contract: clearScene removes it from sceneState()', !ES.sceneState().scenes.some((s) => s.id === h.id));
  ok('pin: removed on dispose, the other pin left alone', sim.mapPins.length === 1 && sim.mapPins[0].label === 'somebody else\'s pin');
  ok('thinning: undone on dispose', sim.ambient.thinned.length === 0);
  ok('fire scene: the helicopters leave the sky', SKY.bodies().every((b) => !/^scene-/.test(b.id) || b.gone));
}

/* a missing pin list is made, then taken away */
{
  const sim = makeSim({ pins: null });
  const h = ES.raiseScene(sim, { at: { x: 1700, z: -1110 }, kind: 'fire', radius: 150, crews: { fire: 1, ambulance: 1, police: 1 }, helis: {}, label: 'Fire' });
  ok('pin: with no list, one is made for the pin', Array.isArray(sim.mapPins) && sim.mapPins.length === 1);
  h.dispose();
  ok('pin: and taken away again when the scene goes', sim.mapPins === null);
}

/* pending `at` */
{
  const sim = makeSim();
  let where = null;
  const h = ES.raiseScene(sim, { at: () => where, kind: 'police', radius: 150, crews: { police: 2, fire: 0, ambulance: 0 }, helis: {}, label: 'Later' });
  ok('contract: an `at` function returning null leaves the scene pending, nothing placed', h.pending && h.state().vehicles.length === 0 && sim.mapPins.length === 1);
  h.update(0.1);
  ok('contract: still pending while it keeps answering null', h.pending);
  where = { x: 1700, z: -1110 };
  h.update(0.1);
  ok('contract: built on the frame `at` answers', !h.pending && h.state().vehicles.length === 2 && sim.mapPins.length === 2);
  h.dispose();
}

/* "Return to the airfield" (stop 'airport'): a feature's own scene stays; a mission's declared one goes and comes back with its step */
{
  const EXTS = await import(src + 'game/extensions.js');
  const ext = EXTS.extensions().find((e) => e.id === 'emergency-scene');
  ok('extension: emergency-scene is registered', !!ext);
  if (ext) {
    const sim = makeSim();
    sim.mode = 'mission';
    sim.runner = {
      status: 'running',
      stepIndex: 0,
      step: { id: 'go' },
      def: { id: 'test', scenes: [{ step: 'start', kind: 'police', at: { x: 1700, z: -1110 }, radius: 150, crews: { police: 2, fire: 0, ambulance: 0 }, helis: {}, label: 'Declared' }] },
    };
    ext.startMode(sim, 'mission');
    const own = ES.raiseScene(sim, { at: { x: 1700, z: -1110 }, kind: 'fire', radius: 150, crews: { fire: 1, ambulance: 0, police: 0 }, helis: {}, label: 'Own' });
    ext.update(sim, 0.1);
    const s0 = ES.sceneState();
    ok('stop airport: the mission\'s declared scene is raised on its step, marked declared, beside the feature\'s own', s0.scenes.length === 2 && s0.scenes.filter((s) => s.declared).length === 1 && !s0.scenes.find((s) => s.id === own.id).declared && s0.raised.length === 1, JSON.stringify(s0.scenes.map((s) => [s.pin && s.pin.label, s.declared])));
    ext.stop(sim, 'airport');
    const s1 = ES.sceneState();
    ok('stop airport: "Return to the airfield" keeps the feature\'s own scene and takes the mission\'s down', s1.scenes.length === 1 && s1.scenes[0].id === own.id && !s1.scenes[0].declared && s1.raised.length === 0, JSON.stringify(s1.scenes.map((s) => [s.pin && s.pin.label, s.declared])));
    ok('stop airport: the own scene\'s pin and thinning are untouched', sim.mapPins.some((p) => p.label === 'Own') && !sim.mapPins.some((p) => p.label === 'Declared') && sim.ambient.thinned.length === 1);
    // returnToAirport starts the mission from the top: its first step comes round again.
    ext.update(sim, 0.1);
    const s2 = ES.sceneState();
    ok('stop airport: the restarted mission raises its scene again, the feature\'s own still there', s2.scenes.length === 2 && s2.scenes.filter((s) => s.declared).length === 1 && s2.scenes.some((s) => s.id === own.id), `${s2.scenes.length} scenes`);
    ext.stop(sim, 'menu');
    ok('stop menu: the end of the flight takes everything down', ES.sceneState().scenes.length === 0 && ES.sceneState().raised.length === 0 && sim.ambient.thinned.length === 0 && sim.mapPins.length === 1);
  }
}

/* ------------------------------------------------------------------ */
/* 3. The light bars                                                   */
/* ------------------------------------------------------------------ */

{
  const was = FS.FLASH.reduce;
  const sample = (secs, hz) => {
    const out = { a: [], b: [] };
    const lv = { a: 0, b: 0 };
    for (let i = 0; i <= secs * hz; i++) {
      MD.beaconLevels(i / hz, lv);
      out.a.push(lv.a);
      out.b.push(lv.b);
    }
    return out;
  };
  /** Rising crossings of half the peak, as times. */
  const flashes = (arr, hz) => {
    const peak = Math.max(...arr);
    const t = [];
    for (let i = 1; i < arr.length; i++) if (arr[i - 1] < peak / 2 && arr[i] >= peak / 2) t.push(i / hz);
    return t;
  };
  const perSecondMax = (times) => {
    let worst = 0;
    for (const t0 of times) worst = Math.max(worst, times.filter((t) => t >= t0 && t < t0 + 1).length);
    return worst;
  };
  FS.FLASH.reduce = true;
  const soft = sample(10, 240);
  const fa = flashes(soft.a, 240);
  const maxStep = Math.max(...soft.a.slice(1).map((v, i) => Math.abs(v - soft.a[i])));
  ok('light bars, Reduce flashing on: one soft pulse a second per side (≤ 1 Hz)', perSecondMax(fa) <= 1 && fa.length >= 9, `${fa.length} pulses in 10 s, worst second ${perSecondMax(fa)}`);
  ok('light bars, Reduce flashing on: no hard edges (largest step between 240 Hz samples under 2% of full)', maxStep < 0.02, maxStep.toFixed(4));
  ok('light bars, Reduce flashing on: no brighter than CAPS.strobe', Math.max(...soft.a, ...soft.b) <= FS.CAPS.strobe + 1e-9, Math.max(...soft.a).toFixed(3));
  FS.FLASH.reduce = false;
  const hard = sample(10, 240);
  const ha = flashes(hard.a, 240);
  const hb = flashes(hard.b, 240);
  const gaps = ha.slice(1).map((t, i) => t - ha[i]);
  ok('light bars, Reduce flashing off: never more than 3 flashes in any second per side', perSecondMax(ha) <= FS.MAX_FLASHES_PER_SECOND && perSecondMax(hb) <= FS.MAX_FLASHES_PER_SECOND, `worst second ${perSecondMax(ha)} / ${perSecondMax(hb)}`);
  ok('light bars, Reduce flashing off: flashes never closer than MIN_FLASH_GAP', gaps.every((g) => g >= FS.MIN_FLASH_GAP - 1e-6), `shortest ${Math.min(...gaps).toFixed(3)} s`);
  ok('light bars, Reduce flashing off: the two sides alternate', hard.a.every((v, i) => Math.abs(v + hard.b[i] - 1) < 1e-9));
  FS.FLASH.reduce = was;
}

/* ------------------------------------------------------------------ */
/* 6. The missions' own scenes                                         */
/* ------------------------------------------------------------------ */

{
  const big = FIRE.MISSIONS.find((m) => m.id === 'fire-bigburn');
  ok('the Big Burn declares a scene', !!(big && Array.isArray(big.scenes) && big.scenes.length === 1 && big.scenes[0].kind === 'fire'));
  if (big && big.scenes) {
    loadMap('meadow');
    const sim = makeSim();
    const entry = big.scenes[0];
    const h = ES.raiseScene(sim, entry);
    const st = h.state();
    const bad = audit(st, entry.keepClear || []);
    ok('the Big Burn\'s scene: raised at once (step start), every rule kept', st.built && bad.length === 0, bad.join('; '));
    ok('the Big Burn\'s scene: on the town side of the fire, 600-900 m from its centre', Math.hypot(st.at.x - 2000, st.at.z + 1800) >= 600 && Math.hypot(st.at.x - 2000, st.at.z + 1800) <= 900 && TR.heightAt(st.at.x, st.at.z) > 1.5, `${Math.round(Math.hypot(st.at.x - 2000, st.at.z + 1800))} m, ${TR.heightAt(st.at.x, st.at.z).toFixed(0)} m up`);
    ok('the Big Burn\'s scene: keeps clear of the scoop lane and the drop circle', (entry.keepClear || []).length >= 2);
    ok('the Big Burn\'s scene: news, police and a bucket helicopter', st.helis.map((q) => q.role).sort().join(',') === 'bucket,news,police', st.helis.map((q) => q.role).join(','));
    h.dispose();
  }
  for (const id of ['event-hijack', 'event-hijack-real']) {
    const def = EV.MISSIONS.find((m) => m.id === id);
    ok(`${id} declares a police scene`, !!(def && Array.isArray(def.scenes) && def.scenes.length === 1 && def.scenes[0].kind === 'police'));
    if (!def || !def.scenes) continue;
    const entry = def.scenes[0];
    ok(`${id}: the scene waits for the step the story stops in`, entry.step === (id === 'event-hijack' ? 'stand' : 'stop'), entry.step);
    loadMap('gateway');
    // The aeroplane, stopped on the remote runway's far end (the by-the-book ending) or on the stand.
    const sim = makeSim({ player: { x: 1300, y: 40, z: 900 } });
    sim.aircraft.onGround = true;
    sim.aircraft.vel.set(0, 0, 0);
    const h = ES.raiseScene(sim, entry);
    const st = h.state();
    const bad = audit(st, entry.keepClear || []);
    ok(`${id}: raised round the stopped aeroplane, nothing on either runway strip or its centreline`, st.built && bad.length === 0 && st.vehicles.every((v) => !TR.isOnAnyRunway(v.x, v.z, 0)), bad.join('; ') || `${st.vehicles.length} vehicles`);
    ok(`${id}: fire engines and ambulances staged off the strip, outside a 150-200 m ring`, st.staged && st.staged.fire >= 1 && st.staged.ambulance >= 1 && st.radius >= 150 && st.radius <= 200, JSON.stringify(st.staged));
    ok(`${id}: police and news helicopters 500 m off and 300 m up`, st.helis.length === 2 && st.helis.every((q) => q.r >= 500 && q.agl >= 300), st.helis.map((q) => `${q.role} r${q.r} ${q.agl}m`).join(', '));
    h.dispose();
    // Still rolling: the scene waits.
    const sim2 = makeSim({ player: { x: 1300, y: 40, z: 900 } });
    sim2.aircraft.onGround = true;
    sim2.aircraft.vel.set(30, 0, 0);
    const h2 = ES.raiseScene(sim2, entry);
    ok(`${id}: while the aeroplane still rolls, the scene waits`, h2.pending);
    h2.dispose();
  }
}

/* ------------------------------------------------------------------ */

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) {
  console.log(fails.map((f) => '  FAIL ' + f).join('\n'));
  process.exit(1);
}

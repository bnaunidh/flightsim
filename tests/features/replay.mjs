/**
 * Node checks for the instant replay (src/features/breakup.js, "The instant
 * replay"). Run from the repo root with plain node:
 *
 *   node tests/features/replay.mjs
 *
 * The owner's bug (2026-10-17): the replay showed the crash damage — the
 * wreck, the smoke, the scorch — BEFORE the crash happened, because none of
 * it was keyed to replay time. So, with a real aeroplane flown into real
 * ground on the real physics, the break-up feature installed on a bare sim
 * and the game's own wreck beside it:
 *
 *   1. THE RECORDING opens on the crash frame: the effects of the hit itself
 *      carry time 0, every effect after it its own time, and what the wreck
 *      was started with is kept.
 *   2. BEFORE THE HIT nothing of the crash is shown: no fire or smoke, the
 *      wreck (fireball, column, scorch, debris) hidden, every piece that came
 *      off riding on the airframe where it sat — for every frame of the
 *      pre-roll, not just the first.
 *   3. AT THE HIT the effects start and the wreck appears, and from then on
 *      the wreck's own clock agrees with the replay's.
 *   4. SCRUBBING back and forth rebuilds the same world each time: the same
 *      piece poses, the same wreck (seeded), the effects cleared and played
 *      again up to that time.
 *   5. PAUSE holds time; the replay's keys are consumed while it plays.
 *   6. THE END (played through, closed early, or a restart) gives the live
 *      world back exactly: the fire that was burning, the wreck where it
 *      stood, the pieces where they lie — and the wreck is no longer held.
 *   7. FRAME COST: a replay frame is cheap and a scrub is a few milliseconds.
 *   8. AT SEA the same holds, with the wreck's splash instead of its fire.
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
const P = await imp('aircraft/physics.js');
const TER = await imp('world/terrain.js');
const A = await imp('aircraft/model-adapter.js');
const X = await imp('game/extensions.js');
const F = await imp('features/breakup.js');
const { Wreck } = await imp('game/wreck.js');
TER.applyMap(TER.MAP.id);

let pass = 0;
let fail = 0;
function ok(name, cond, detail = '') {
  if (cond) pass++;
  else fail++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail !== '' ? '  — ' + detail : ''}`);
}
const f1 = (v) => (Math.round(v * 10) / 10).toString();
const f2 = (v) => (Math.round(v * 100) / 100).toString();
const med = (arr) => arr.slice().sort((a, b) => a - b)[arr.length >> 1] || 0;

const ext = X.extensions().find((e) => e.id === 'breakup');
ok('the break-up feature registers itself on import', !!ext);
const D = () => F.breakupDebug();

/* ---- a bare sim with the game's wreck on it --------------------------- */

function makeSim(typeId) {
  const type = T.getAircraft(typeId);
  P.applyAircraft(type.id);
  const scene = new THREE.Scene();
  const model = A.createAircraftModel({ type });
  scene.add(model);
  const ac = new P.Aircraft();
  const sim = {
    scene,
    camera: new THREE.PerspectiveCamera(60, 1.6, 0.5, 40000),
    aircraft: ac,
    model,
    aircraftType: type,
    settings: { quality: 'low', crashSlowMo: false },
    state: 'flying',
    mode: 'free',
    rig: { kick() {}, initialised: true },
    wreck: null,
    // main.js's frame, as far as the wreck is concerned.
    update(dt) {
      this.wreck.update(dt);
    },
  };
  sim.wreck = new Wreck(scene);
  return sim;
}

/** Put the model where the aeroplane is (main.js does this every frame). */
function syncModel(sim) {
  A.syncAircraftModel(sim.model, sim.aircraft);
  if (!sim.model.matrixAutoUpdate) sim.model.updateMatrix();
  sim.model.updateMatrixWorld(true);
}

function frame(sim, dt = 1 / 30) {
  syncModel(sim);
  sim.update(dt);
  ext.update(sim, dt);
}

/** Flat ground on the island for the crash, or open sea. */
function spot(water) {
  for (let r = 300; r < 12000; r += 150) {
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      const h = TER.heightAt(x, z);
      if (TER.platformAt(x, z)) continue;
      if (water ? h < -8 : h > 4 && Math.abs(TER.heightAt(x + 30, z) - h) < 3 && Math.abs(TER.heightAt(x, z + 30) - h) < 3) return { x, z, h: Math.max(h, 0) };
    }
  }
  return null;
}

/** Fly for two seconds, then dive it nose-first into the surface at 55 m/s (hard enough to come apart). Then `after` seconds of the live world. */
function crashInto(sim, at, water, after = 7) {
  const ac = sim.aircraft;
  ac.reset({ pos: new THREE.Vector3(at.x - 90, at.h + 60, at.z), headingDeg: 90, speed: 55, altAGL: 60, engineOn: true });
  ac.vel.set(45, -30, 0);
  for (let i = 0; i < 60; i++) {
    // Hand-flown, as a recording of a flight: a steep dive towards the spot.
    ac.pos.addScaledVector(ac.vel, 1 / 30);
    ac.pos.y = Math.max(ac.pos.y, at.h + 2);
    frame(sim);
  }
  ac.pos.set(at.x, at.h + 0.5, at.z);
  ac.vel.set(45, -30, 0);
  syncModel(sim);
  const hp = (P.SPEC.hardPoints || []).find((h) => h.part === 'nose');
  const worldPoint = hp ? hp.pos.clone().applyQuaternion(ac.quat).add(ac.pos) : ac.pos.clone().setY(at.h);
  const contact = { worldPoint, part: 'nose', surfaceKind: water ? 'water' : 'ground' };
  // main.js's own CRASH listener starts the wreck; the aircraft's crash() emits the event the feature listens on.
  const inWater = TER.heightAt(ac.pos.x, ac.pos.z) < 0 && ac.pos.y < 4;
  ac.on(P.EVENTS.CRASH, () => sim.wreck.start(ac.pos, ac.vel, inWater));
  ac.crash(water ? 'You flew into the sea' : 'The belly hit the ground', contact);
  for (let i = 0; i < Math.round(after * 30); i++) frame(sim);
}

/** Where every piece is, as numbers, for comparing two moments. */
function piecePoses() {
  return D().S.pieces.map((p) => [p.group.visible ? 1 : 0, ...p.group.position.toArray().map((v) => Math.round(v * 1000) / 1000), ...p.group.quaternion.toArray().map((v) => Math.round(v * 10000) / 10000)]);
}
function wreckPose(w) {
  return [w.active ? 1 : 0, w.group.visible ? 1 : 0, Math.round(w.t * 1000) / 1000, Math.round(w.mark.scale.x * 1000) / 1000, ...w.debris.map((d) => [d.mesh.visible ? 1 : 0, ...d.mesh.position.toArray().map((v) => Math.round(v * 1000) / 1000)])];
}
function fxState() {
  const fx = D().S.fx;
  return { busy: fx.busy, alive: fx.pools.map((p) => p.alive), emitters: fx.emitters.length, pops: fx.pops.length };
}
/** Pieces that came off AT the hit: within the airframe's own length of it means "on it". */
function attachedOk(sim) {
  const r = D().S.rec;
  const L = (P.SPEC && P.SPEC.wingSpan) || 11;
  const centre = new THREE.Vector3().setFromMatrixPosition(sim.model.matrixWorld);
  return r.tracks.filter((tr) => tr.attach && !tr.piece.gone).every((tr) => tr.piece.group.visible && tr.piece.group.position.distanceTo(centre) < L);
}

/* ====================================================================== */
/* 1-7. On land                                                           */
/* ====================================================================== */
{
  const sim = makeSim('skylark');
  const group = new THREE.Group();
  sim.scene.add(group);
  ext.install(sim);
  ext.buildWorld(sim, group);
  ext.startMode(sim);
  const land = spot(false);
  ok('land: a flat spot for the crash', !!land, land ? `${Math.round(land.x)}, ${Math.round(land.z)} at ${f1(land.h)} m` : 'none');
  crashInto(sim, land, false, 7);
  const ac = sim.aircraft;
  const w = sim.wreck;
  const rec = D().recording;

  /* ---- 1. the recording ---- */
  ok('land: the aeroplane crashed, and came apart', ac.crashed && D().pieces.length > 0, `${D().pieces.length} pieces`);
  ok('land: the recording is open from the hit, sealed with the pieces, with the pre-roll kept', !!rec && rec.sealed && rec.frames > 3 && rec.tracks === D().pieces.length && rec.pre > 10, JSON.stringify(rec));
  const fxEv = D().S.rec.fx;
  ok('land: the effects of the hit itself are recorded AT time 0 — the recording opened before the first spark', fxEv.length > 0 && fxEv[0].t === 0 && fxEv.some((e) => e.t === 0 && (e.name === 'dust' || e.name === 'sparks')), `${fxEv.length} effects; first ${fxEv[0] && fxEv[0].name} at ${fxEv[0] && fxEv[0].t}`);
  ok('land: every recorded effect has a time at or after the hit, in order', fxEv.every((e, i) => e.t >= 0 && (i === 0 || e.t >= fxEv[i - 1].t)));
  ok('land: the fire on the pieces is a recorded effect too', fxEv.some((e) => e.name === 'fire'), fxEv.map((e) => e.name).filter((n, i, a) => a.indexOf(n) === i).join(', '));
  ok('land: what the wreck was started with is kept (on land, not in water)', !!D().S.rec.wreck && D().S.rec.wreck.inWater === false && D().S.rec.wreck.pos.distanceTo(new THREE.Vector3(land.x, land.h + 0.5, land.z)) < 0.01);
  ok('land: a replay can be watched', D().canReplay);

  // The live world, seven seconds on: fire burning, the wreck stood up, pieces lying about.
  const liveFx = fxState();
  const livePieces = piecePoses();
  const liveWreck = wreckPose(w);
  ok('land: live, seven seconds on, the fire still burns and the wreck stands (what a replay must not disturb)', liveFx.busy && w.active && w.group.visible && Math.abs(w.t - 7) < 0.2, `fx busy ${liveFx.busy}, wreck t ${f2(w.t)}`);

  /* ---- 2. before the hit ---- */
  const started = D().startReplay(sim, false);
  let R = D().replay;
  ok('land: the replay starts a second and a half before the hit', started && D().replaying && R && R.start < -1 && Math.abs(R.t - R.start) < 1e-9, R ? `t ${f2(R.t)}, start ${f2(R.start)}, end ${f2(R.end)}` : 'none');
  ok('land: …and takes the wreck over (held) with the game\'s update() leaving it alone', R.wreckHeld && w.held && (() => { const t0 = w.t; w.update(0.5); return w.t === t0; })());
  ok('land: BEFORE THE HIT: no fire, no smoke', !fxState().busy, JSON.stringify(fxState()));
  ok('land: BEFORE THE HIT: no wreck — no fireball, no column, no scorch, no debris, no firelight', !w.group.visible && w.light.intensity === 0);
  ok('land: BEFORE THE HIT: every piece that came off rides on the airframe where it sat', attachedOk(sim));
  // …for every frame of the pre-roll, not just the first.
  let preFrames = 0;
  let preClean = true;
  let firstFxT = null;
  let firstWreckT = null;
  const times = [];
  while (D().replaying && D().replay.t < 0) {
    frame(sim);
    R = D().replay;
    if (R && R.t < 0) {
      preFrames++;
      if (fxState().busy || w.group.visible || !attachedOk(sim)) preClean = false;
    }
  }
  ok('land: …and stays that way through the whole pre-roll', preClean && preFrames > 20, `${preFrames} frames before the hit`);

  /* ---- 3. at the hit, and after ---- */
  for (let i = 0; i < 30 * 4 && D().replaying; i++) {
    frame(sim);
    R = D().replay;
    if (firstFxT === null && fxState().busy) firstFxT = R.t;
    if (firstWreckT === null && w.group.visible) firstWreckT = R.t;
    times.push([R.t, w.t]);
  }
  R = D().replay;
  ok('land: AT THE HIT the effects start (sparks and dust, within a frame of time 0)', firstFxT !== null && firstFxT >= 0 && firstFxT < 0.1, `first at ${firstFxT === null ? 'never' : f2(firstFxT)}`);
  ok('land: AT THE HIT the wreck appears (within a frame of time 0)', firstWreckT !== null && firstWreckT >= 0 && firstWreckT < 0.1, `first at ${firstWreckT === null ? 'never' : f2(firstWreckT)}`);
  ok('land: from then on the wreck\'s clock is the replay\'s clock', times.filter(([t]) => t >= 0.05).every(([t, wt]) => Math.abs(t - wt) < 0.04), times.filter(([t]) => t >= 0.05).slice(-1).map(([t, wt]) => `replay ${f2(t)}, wreck ${f2(wt)}`).join(''));
  const spread = D().S.rec.tracks.filter((tr) => tr.attach && !tr.piece.gone).some((tr) => tr.piece.group.position.distanceTo(new THREE.Vector3().setFromMatrixPosition(sim.model.matrixWorld)) > 0.5);
  ok('land: by now the pieces have left the airframe along their recorded tracks', spread && R && R.t > 2, R ? `t ${f2(R.t)}` : '');
  ok('land: the fire is burning in the replay, where it did', fxState().busy && fxState().emitters > 0, JSON.stringify(fxState()));

  /* ---- 4. scrubbing ---- */
  D().seekReplay(sim, 2.0);
  const atTwoA = { pieces: piecePoses(), wreck: wreckPose(w), fx: fxState(), cursor: D().replay.fxCursor };
  ok('land: a seek to +2 s puts the wreck at 2 s and the effects up to 2 s', Math.abs(w.t - 2) < 1e-6 && w.group.visible && atTwoA.cursor === fxEv.filter((e) => e.t <= 2).length && atTwoA.fx.busy, `wreck t ${f2(w.t)}, ${atTwoA.cursor} effects`);
  D().seekReplay(sim, -1.0);
  ok('land: a seek BACK to -1 s: no effects, no wreck, the pieces back on the airframe', !fxState().busy && !w.group.visible && attachedOk(sim) && D().replay.fxCursor === 0, `cursor ${D().replay.fxCursor}`);
  D().seekReplay(sim, 2.0);
  const atTwoB = { pieces: piecePoses(), wreck: wreckPose(w), cursor: D().replay.fxCursor };
  ok('land: forward again to +2 s: the same pieces in the same places', JSON.stringify(atTwoA.pieces) === JSON.stringify(atTwoB.pieces));
  ok('land: …the same wreck (the same debris in the same places — its random numbers are seeded)', JSON.stringify(atTwoA.wreck) === JSON.stringify(atTwoB.wreck));
  ok('land: …the same effects played up to that time', atTwoA.cursor === atTwoB.cursor && fxState().busy);
  D().seekReplay(sim, 0.5);
  const half = wreckPose(w);
  ok('land: a seek a little back (+0.5 s) reruns the wreck from the hit rather than winding it on', Math.abs(w.t - 0.5) < 1e-6 && half[2] === 0.5);
  D().seekReplay(sim, 1e9);
  ok('land: a seek past the end stops at the end', Math.abs(D().replay.t - D().replay.end) < 1e-9);
  D().seekReplay(sim, -1e9);
  ok('land: a seek before the start stops at the start', Math.abs(D().replay.t - D().replay.start) < 1e-9);

  // Scrubbing is not a strobe: back over the hit and forward onto it again at once
  // shows the fire without the flash (Reduce flashing is on by default).
  const spin = (ms) => { const a = performance.now(); while (performance.now() - a < ms); };
  spin(450);
  D().seekReplay(sim, -1.0);
  D().seekReplay(sim, 0.1);
  const flash1 = { scale: w.flashScale, light: w.light.intensity };
  D().seekReplay(sim, -1.0);
  D().seekReplay(sim, 0.1);
  const flash2 = { scale: w.flashScale, light: w.light.intensity, noFlare: D().S.fx.noFlare };
  ok('land: a scrub onto the hit flashes it; straight back and onto it again does not (the fire is there, the flash is not)',
    flash1.scale === 1 && flash2.scale === 0 && flash2.light < flash1.light && w.group.visible && flash2.noFlare === false, `${JSON.stringify(flash1)} then ${JSON.stringify(flash2)}`);
  D().seekReplay(sim, 1.0);
  ok('land: …and off the flash the firelight is whole again', w.flashScale === 1);
  const vecArgs = D().S.rec.fx.flatMap((e) => e.args.filter((a) => a && a.isVector3));
  const liveVecs = new Set([sim.aircraft.vel, ...D().S.pieces.map((p) => p.body.vel)]);
  ok('land: a velocity handed to an effect is recorded as a copy (the body goes on moving)', vecArgs.every((v) => !liveVecs.has(v)), `${vecArgs.length} vectors`);

  /* ---- 5. pause and keys ---- */
  D().seekReplay(sim, 1.0);
  const paused = D().pauseReplay(sim, true);
  const tP = D().replay.t;
  const wP = w.t;
  for (let i = 0; i < 10; i++) frame(sim);
  ok('land: paused, time stands still — the replay\'s, the wreck\'s, the effects\'', paused === true && D().replay.t === tP && w.t === wP && D().replay.fxCursor === fxEv.filter((e) => e.t <= 1).length);
  D().pauseReplay(sim, false);
  for (let i = 0; i < 10; i++) frame(sim);
  ok('land: unpaused, it runs on', D().replay.t > tP + 0.1, `${f2(tP)} → ${f2(D().replay.t)}`);
  ok('land: Space, the arrows and Escape are the replay\'s while it plays (the game does not act on them)', ['Space', 'ArrowLeft', 'ArrowRight', 'Escape'].every((c) => ext.key(sim, c, true) === true) && ext.key(sim, 'KeyW', true) === false);

  /* ---- 7. frame cost ---- */
  D().seekReplay(sim, 0.2);
  const costs = [];
  for (let i = 0; i < 90 && D().replaying; i++) {
    const a = performance.now();
    frame(sim);
    costs.push(performance.now() - a);
  }
  const seeks = [];
  for (let i = 0; i < 12; i++) {
    const a = performance.now();
    D().seekReplay(sim, i % 2 ? 0.3 : D().replay.end - 0.1);
    seeks.push(performance.now() - a);
  }
  ok('land: a replay frame costs about what a live one does (median under 2.5 ms here; a Chromebook is several times slower)', med(costs) < 2.5, `median ${med(costs).toFixed(2)} ms, worst ${Math.max(...costs).toFixed(1)}`);
  ok('land: a scrub to the far end and back is a few milliseconds (median under 15)', med(seeks) < 15, `median ${med(seeks).toFixed(2)} ms, worst ${Math.max(...seeks).toFixed(1)}`);

  /* ---- 6. the end: closed early ---- */
  D().endReplay(sim, false);
  ok('land: closed early: the live fire and smoke are back as they were', JSON.stringify(fxState()) === JSON.stringify(liveFx), `${JSON.stringify(fxState())} vs ${JSON.stringify(liveFx)}`);
  ok('land: …the wreck is back where it stood, at its own time, and no longer held', !w.held && JSON.stringify(wreckPose(w)) === JSON.stringify(liveWreck), `t ${f2(w.t)}`);
  ok('land: …and the pieces lie where they lay', JSON.stringify(piecePoses()) === JSON.stringify(livePieces));
  ok('land: …and the game\'s update() moves the wreck again', (() => { const t0 = w.t; sim.wreck.update(0.1); return Math.abs(w.t - t0 - 0.1) < 1e-9; })());
  ok('land: after the replay the keys are the game\'s again', ext.key(sim, 'Space', true) === false);

  /* ---- 6. the end: played through ---- */
  const live2 = { fx: fxState(), pieces: piecePoses(), wreck: wreckPose(w) };
  D().startReplay(sim, false);
  let n = 0;
  while (D().replaying && n++ < 30 * 40) frame(sim);
  ok('land: played through, the replay ends on its own', !D().replaying && n < 30 * 40, `${n} frames`);
  ok('land: …and gives the live world back (fire, wreck, pieces)', JSON.stringify(fxState()) === JSON.stringify(live2.fx) && JSON.stringify(wreckPose(w)) === JSON.stringify(live2.wreck) && JSON.stringify(piecePoses()) === JSON.stringify(live2.pieces) && !w.held);

  /* ---- 6. the end: a restart in the middle ---- */
  D().startReplay(sim, false);
  for (let i = 0; i < 20; i++) frame(sim);
  ok('land: (a replay is playing again)', D().replaying && w.held);
  ext.startMode(sim);
  sim.wreck.clear(); // main.js clears the wreck on a new flight
  ok('land: a restart in the middle of a replay ends it, lets the wreck go and clears everything', !D().replaying && !w.held && !w.active && D().pieces.length === 0 && !D().canReplay);
  ext.stop(sim);
}

/* ====================================================================== */
/* 8. At sea                                                              */
/* ====================================================================== */
{
  const sim = makeSim('courier');
  const group = new THREE.Group();
  sim.scene.add(group);
  ext.install(sim);
  ext.buildWorld(sim, group);
  ext.startMode(sim);
  const sea = spot(true);
  ok('sea: open water for the ditching', !!sea, sea ? `${Math.round(sea.x)}, ${Math.round(sea.z)}` : 'none');
  crashInto(sim, sea, true, 7);
  const w = sim.wreck;
  const rec = D().S.rec;
  ok('sea: the recording kept that the wreck went into the water', !!rec && rec.wreck && rec.wreck.inWater === true && D().canReplay);
  ok('sea: live, the splash rings have had their moment and the aeroplane floats (the sink has begun)', w.active && w.inWater && !!D().sink, D().sink ? `sink t ${f1(D().sink.t)}` : 'no sink');
  const liveFx = fxState();
  const liveWreck = wreckPose(w);
  const liveSink = JSON.stringify(D().sink);
  D().startReplay(sim, false);
  ok('sea: before the hit: no spray, no rings, no foam', !fxState().busy && !w.group.visible);
  let ringsSeen = false;
  let bubblesBefore = false;
  let flameEarly = false;
  while (D().replaying && D().replay.t < 1.5) {
    frame(sim);
    const R = D().replay;
    if (R && R.t < 0 && fxState().busy) bubblesBefore = true;
    // The splash is white until the fuel catches (0.85 s): the live wreck's flame tint must not carry into the re-run.
    if (R && R.t > 0.05 && R.t < 0.8 && w.fire.points.material.uniforms.uTint.value.b < 0.9) flameEarly = true;
    if (R && R.t > 0.3 && w.group.visible && w.rings.some((r) => r.mesh.visible && r.mesh.material.opacity > 0.03)) ringsSeen = true;
  }
  ok('sea: nothing splashes before the hit; the rings spread after it', !bubblesBefore && ringsSeen);
  ok('sea: the splash stays white until the fuel catches — no flame colour carried over from the live wreck', !flameEarly);
  const sinkDuring = JSON.stringify(D().sink);
  ok('sea: the slow sink stands still while the replay plays (the broken world is paused)', sinkDuring === liveSink);
  D().endReplay(sim, false);
  ok('sea: the live splash and sink are given back', JSON.stringify(fxState()) === JSON.stringify(liveFx) && JSON.stringify(wreckPose(w)) === JSON.stringify(liveWreck) && !w.held);
  ext.stop(sim);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

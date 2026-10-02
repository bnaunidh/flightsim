/**
 * Node checks for the walking pilot: the ragdoll, being knocked down, and the
 * pilot in multiplayer.
 *
 *   node tests/features/pilot.mjs
 *
 *   RAGDOLL     ../../src/features/ragdoll.js: knocked at walking pace up to a
 *               fighter's, low and high, every way round — it goes down, lies
 *               still (asleep, then not one point moves), never sinks into
 *               the ground, never stretches a bone, never flies apart; knees
 *               bend the right way; the same knock is the same fall (so every
 *               game in a lobby sees it); it floats in the sea, stops at a wall,
 *               lies on a slope; drawn with the person's own joints, the
 *               figure matches the points; it gets up clean. And what it costs.
 *   KNOCKDOWN   ../../src/features/knockdown.js against a stand-in game: a
 *               taxiing A320 runs the pilot down (WASTED, the words), one that
 *               passes beside does not, nor one that creeps; a fighter at
 *               60 m/s on a 10 fps machine does not skip over you; the pause
 *               switch off is a knock with no WASTED screen; you get up beside
 *               it, clear of it, and are not knocked straight over again.
 *   WIRE        protocol.js's walker tail: round trip, size, PROTO 4, junk
 *               refused, a snapshot without one still a snapshot; pilot-mp.js's
 *               'pilot:down' checked on arrival.
 *   REMOTE      multiplayer/walkers.js: a friend's pilot drawn between their
 *               snapshots, close to where they really are; their fall from the
 *               event; up again when their snapshot says so.
 */

const el = () => {
  const e = {
    style: { setProperty() {} }, dataset: {}, children: [], hidden: false, textContent: '', innerHTML: '', className: '', isConnected: true,
    classList: { _s: new Set(), add(...c) { c.forEach((x) => this._s.add(x)); }, remove(...c) { c.forEach((x) => this._s.delete(x)); }, toggle() {}, contains(c) { return this._s.has(c); } },
    appendChild(c) { this.children.push(c); return c; }, append(...c) { this.children.push(...c); }, remove() {}, removeChild() {},
    querySelector: () => el(), querySelectorAll: () => [], setAttribute() {}, addEventListener() {}, getContext: () => null,
    get firstChild() { const self = this; return this.children.length ? { remove() { self.children.shift(); } } : null; },
  };
  return e;
};
global.document = { createElement: el, body: el(), head: el(), getElementById: () => null, querySelectorAll: () => [] };
global.window = { innerWidth: 1280, innerHeight: 720, setInterval, clearInterval, addEventListener() {} };

const results = [];
const ok = (name, pass, detail = '') => {
  results.push({ name, pass: !!pass });
  console.log(`${pass ? 'ok  ' : 'FAIL'} ${name}${detail !== '' ? ` — ${typeof detail === 'string' ? detail : JSON.stringify(detail)}` : ''}`);
  return !!pass;
};

const SRC = '../../src/';
const THREE = await import(SRC + 'vendor/three.module.js');
const RD = await import(SRC + 'features/ragdoll.js');
const P = await import(SRC + 'features/staff/person.js');
const U = await import(SRC + 'features/uniforms.js');
const { Ragdoll, GetUp, cleanRig, RAGDOLL, PT } = RD;

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const flat = { floor: () => 0, water: () => -Infinity, collide: null };

/* ================================================================== RAGDOLL */

function fall(speed, hitY, heading, world = flat, secs = 6, dt = 1 / 60) {
  const r = new Ragdoll().standAt(0, 0, 0, 0);
  const h = (heading * Math.PI) / 180;
  r.knock({ x: Math.sin(h) * speed, y: 0, z: -Math.cos(h) * speed }, hitY);
  const start = r.point(PT.LH);
  let downAt = null;
  let sleptAt = null;
  let maxD = 0;
  // Jitter is motion that keeps changing its mind: a point going up, down, up, down.
  const hist = [];
  let jerk = 0;
  for (let t = 0; t < secs; t += dt) {
    r.step(dt, world);
    if (downAt === null && r.height() < 0.5) downAt = t;
    if (sleptAt === null && r.asleep) sleptAt = t;
    hist.push(r.points());
    maxD = Math.max(maxD, Math.hypot(r.pelvis.x - start.x, r.pelvis.z - start.z));
  }
  // In the last second before it lay still: zig-zags — a point going up, down and up again (or down,
  // up, down) on three frames running, by more than 2 mm each time. A swing or a bounce is never that;
  // chatter on the ground is nothing else.
  if (sleptAt !== null) {
    const end = Math.round(sleptAt / dt);
    const lim = 0.002;
    for (let i = 0; i < hist[0].length; i++) {
      let zz = 0;
      for (let k = Math.max(3, end - Math.round(1 / dt)); k <= end && k < hist.length; k++) {
        const a = hist[k - 2][i] - hist[k - 3][i];
        const b = hist[k - 1][i] - hist[k - 2][i];
        const c = hist[k][i] - hist[k - 1][i];
        if (Math.abs(a) > lim && Math.abs(b) > lim && Math.abs(c) > lim && Math.sign(a) === -Math.sign(b) && Math.sign(b) === -Math.sign(c)) zz++;
      }
      jerk = Math.max(jerk, zz);
    }
  }
  return { r, downAt, sleptAt, jerk, maxD, thrown: Math.hypot(r.pelvis.x - start.x, r.pelvis.z - start.z) };
}

{
  ok('ragdoll: fifteen points (head, chest, shoulders, elbows, hands, pelvis, hips, knees, feet) and its constraints', RD.COUNT === 15 && RD.CONSTRAINT_COUNT >= 40, `${RD.CONSTRAINT_COUNT} constraints`);
  const st = new Ragdoll().standAt(0, 0, 0, 0);
  ok('ragdoll: stood up it is a person’s height', Math.abs(st.height() - 1.51) < 0.05, `${st.height().toFixed(2)} m between the head’s middle and the ankles`);
  const cases = [];
  for (const sp of [2, 4, 8, 20, 60]) for (const hy of [0.5, 1.0, 1.6]) for (const hd of [0, 90, 225]) cases.push([sp, hy, hd]);
  const bad = { down: [], sleep: [], sink: [], stretch: [], far: [], moved: [], pop: [] };
  let worstSink = 0;
  let worstStretch = 0;
  let farthest = 0;
  let worstJerk = 0;
  for (const [sp, hy, hd] of cases) {
    const f = fall(sp, hy, hd);
    const tag = `${sp} m/s at ${hy} m, ${hd}°`;
    if (f.downAt === null || f.downAt > 2.5) bad.down.push(tag);
    if (f.sleptAt === null || f.sleptAt > 5) bad.sleep.push(`${tag} (${f.sleptAt})`);
    if (f.r.maxSink > 0.002) bad.sink.push(tag);
    if (f.r.maxStretch > 0.04) bad.stretch.push(`${tag} ${f.r.maxStretch.toFixed(3)}`);
    if (f.maxD > 14) bad.far.push(`${tag} ${f.maxD.toFixed(1)} m`);
    if (sp >= 4 && f.thrown < 0.4) bad.moved.push(tag);
    if (f.jerk > 1) bad.pop.push(`${tag} ${f.jerk} zig-zags`);
    worstJerk = Math.max(worstJerk, f.jerk);
    worstSink = Math.max(worstSink, f.r.maxSink);
    worstStretch = Math.max(worstStretch, f.r.maxStretch);
    farthest = Math.max(farthest, f.maxD);
  }
  ok(`ragdoll: knocked from 2 to 60 m/s, low to high, every way round (${cases.length} falls) — down within 2.5 s`, !bad.down.length, bad.down.join('; '));
  ok('ragdoll: ...and lying still (asleep) within 5 s', !bad.sleep.length, bad.sleep.join('; '));
  ok('ragdoll: ...never into the ground (no point below the floor by 2 mm)', !bad.sink.length, `worst ${(worstSink * 1000).toFixed(2)} mm ${bad.sink.join('; ')}`);
  ok('ragdoll: ...never pulled apart (a bone’s two ends within 4 cm of its length for a frame, at the hardest knock; the figure drawn is turned, never stretched)', !bad.stretch.length, `worst ${(worstStretch * 100).toFixed(1)} cm ${bad.stretch.join('; ')}`);
  ok('ragdoll: ...never flung across the field (thrown at most 14 m, even by a fighter at 60 m/s)', !bad.far.length, `farthest ${farthest.toFixed(1)} m ${bad.far.join('; ')}`);
  ok('ragdoll: ...really thrown by a real knock (4 m/s and up moves the body)', !bad.moved.length, bad.moved.join('; '));
  ok('ragdoll: ...and it settles without jitter — in its last second no point zig-zags (up, down, up on three frames running) more than once: a knee landing jolts once, chatter goes on', !bad.pop.length, `worst ${worstJerk} ${bad.pop.join('; ')}`);

  // Asleep is still: not one point moves.
  const f = fall(8, 0.6, 30);
  const before = f.r.points();
  for (let i = 0; i < 120; i++) f.r.step(1 / 60, flat);
  const after = f.r.points();
  ok('ragdoll: asleep, it does not move at all (two more seconds, not a hundredth of a millimetre)', f.r.asleep && before.every((v, i) => Math.abs(v - after[i]) < 1e-5));

  // Knees bend one way; elbows and knees fold no further than they can.
  const angle = (a, b, c) => {
    const p = f.r;
    const A = p.point(a); const B = p.point(b); const C = p.point(c);
    const u = { x: A.x - B.x, y: A.y - B.y, z: A.z - B.z };
    const v = { x: C.x - B.x, y: C.y - B.y, z: C.z - B.z };
    const d = (u.x * v.x + u.y * v.y + u.z * v.z) / (Math.hypot(u.x, u.y, u.z) * Math.hypot(v.x, v.y, v.z));
    return (Math.acos(Math.max(-1, Math.min(1, d))) * 180) / Math.PI;
  };
  let minJoint = 180;
  let kneeWrong = 0;
  for (const [sp, hy, hd] of [[3, 0.5, 0], [8, 1, 90], [20, 1.6, 180], [9, 0.4, 300], [60, 0.9, 45]]) {
    const g = fall(sp, hy, hd);
    f.r = g.r;
    for (const [a, b, c] of [[PT.LS, PT.LE, PT.LW], [PT.RS, PT.RE, PT.RW], [PT.LH, PT.LK, PT.LF], [PT.RH, PT.RK, PT.RF]]) minJoint = Math.min(minJoint, angle(a, b, c));
    // Knee hinge: the knee is not behind the hip-to-foot line (in the plane square to the hips).
    const p = g.r.points();
    const v = (i) => new THREE.Vector3(p[i * 3], p[i * 3 + 1], p[i * 3 + 2]);
    const axis = v(PT.RH).sub(v(PT.LH)).normalize();
    for (const [H, K, F] of [[PT.LH, PT.LK, PT.LF], [PT.RH, PT.RK, PT.RF]]) {
      const d = v(F).sub(v(H)).normalize();
      const n = new THREE.Vector3().crossVectors(axis, d);
      if (n.length() < 0.2) continue;
      n.normalize();
      const k = v(K).sub(v(H));
      k.addScaledVector(d, -k.dot(d));
      if (k.dot(n) < -0.02) kneeWrong++;
    }
  }
  ok('ragdoll: elbows and knees fold no tighter than about 140° (joint limits hold where it lies)', minJoint > 33, `tightest joint ${minJoint.toFixed(0)}°`);
  ok('ragdoll: knees bend the way knees bend', kneeWrong === 0, `${kneeWrong} backwards`);

  // The same knock is the same fall.
  const a = fall(8, 0.7, 120).r.points();
  const b = fall(8, 0.7, 120).r.points();
  ok('ragdoll: the same knock from the same pose is the same fall, to the bit (every game in a lobby sees one fall)', a.every((x, i) => x === b[i]));
  // ...and near enough the same at 30 fps as at 60, and in WASTED's slow motion.
  const f30 = fall(8, 0.7, 120, flat, 6, 1 / 30).r.pelvis;
  const f60 = fall(8, 0.7, 120, flat, 6, 1 / 60).r.pelvis;
  const slow = new Ragdoll().standAt(0, 0, 0, 0);
  slow.knock({ x: Math.sin(120 * Math.PI / 180) * 8, y: 0, z: -Math.cos(120 * Math.PI / 180) * 8 }, 0.7);
  for (let t = 0; t < 6; t += 1 / 60) slow.step(t < 1.1 ? 0.3 / 60 : 1 / 60, flat);
  ok('ragdoll: a school Chromebook at 30 fps, or WASTED’s slow motion, sees the body land within a metre of where 60 fps does',
    dist(f30, f60) < 1 && dist(slow.pelvis, f60) < 1.5, `30 fps ${dist(f30, f60).toFixed(2)} m, slow motion ${dist(slow.pelvis, f60).toFixed(2)} m`);

  // Water: it floats.
  const sea = { floor: () => -3, water: () => 0, collide: null };
  const w = fall(6, 0.8, 0, sea, 6);
  ok('ragdoll: knocked into the sea it floats at the surface (and never through the sea bed)', w.r.point(PT.CHEST).y > -0.35 && w.r.point(PT.HEAD).y > -0.3 && w.r.maxSink <= 0.002,
    `chest ${w.r.point(PT.CHEST).y.toFixed(2)} m, head ${w.r.point(PT.HEAD).y.toFixed(2)} m`);

  // A wall: a box from x = 1.2 to 3, two metres high.
  const wall = { x0: 1.2, x1: 3, z0: -5, z1: 5, y0: 0, y1: 2 };
  const walled = { floor: () => 0, water: () => -Infinity, collide: (p, r) => (p.x + r > wall.x0 && p.x - r < wall.x1 && p.y - r < wall.y1 ? RD.pushOut(p, r, wall) : false) };
  const wr = new Ragdoll().standAt(0, 0, 0, 90);
  wr.knock({ x: 9, y: 0, z: 0 }, 1);
  let through = 0;
  for (let t = 0; t < 5; t += 1 / 60) {
    wr.step(1 / 60, walled);
    for (let i = 0; i < RD.COUNT; i++) through = Math.max(through, wr.point(i).x - wall.x0);
  }
  ok('ragdoll: thrown at a wall it stops against it (no point more than 3 cm into it)', through < 0.03, `${(through * 100).toFixed(1)} cm`);

  // A slope of 19°: it lands, and lies on it.
  const slope = { floor: (x) => 0.35 * x, water: () => -Infinity, collide: null };
  const sr = new Ragdoll().standAt(0, 0, 0, 0);
  sr.knock({ x: 0, y: 0, z: -6 }, 0.8);
  let sink = 0;
  for (let t = 0; t < 6; t += 1 / 60) {
    sr.step(1 / 60, slope);
    for (let i = 0; i < RD.COUNT; i++) sink = Math.max(sink, 0.35 * sr.point(i).x - sr.point(i).y);
  }
  ok('ragdoll: on a 19° hillside it lies on the hill, not in it', sink < 0.0 + 1e-6 && sr.height() < 1.2, `deepest point ${(-sink * 100).toFixed(1)} cm above the ground's line, height ${sr.height().toFixed(2)} m`);

  // What it costs.
  const cr = new Ragdoll().standAt(0, 0, 0, 0);
  cr.knock({ x: 7, y: 0, z: 3 }, 0.7);
  RAGDOLL.sleepAfter = 1e9; // keep it awake: the cost of a frame of falling, not of sleeping
  // The quickest of six batches of a hundred frames: a machine that pauses this test (the CPU governor) is not the ragdoll's cost.
  let ms = Infinity;
  for (let b = 0; b < 6; b++) {
    const t0 = performance.now();
    for (let i = 0; i < 100; i++) cr.step(1 / 60, flat);
    ms = Math.min(ms, (performance.now() - t0) / 100);
  }
  RAGDOLL.sleepAfter = 0.45;
  ok('ragdoll: a frame of falling costs a small fraction of a millisecond here (under 0.3 ms even on a busy machine)', ms < 0.3, `${(ms * 1000).toFixed(1)} µs a frame (two sub-steps)`);
}

/* ---- drawn with the person's own joints ---------------------------------------- */
{
  const person = U.createUniformPerson('captain', { seed: 5 }) || P.createPerson({ outfit: 'pilot', seed: 5 });
  const scene = new THREE.Scene();
  scene.add(person);
  person.position.set(10, 2, -4);
  person.rotation.set(0, -0.7, 0);
  for (let i = 0; i < 40; i++) P.posePerson(person, 1 / 60, { speed: 1.8, air: false, wave: null });
  const r = new Ragdoll();
  ok('drawn: the ragdoll starts in exactly the pose the pilot is drawn in, mid-stride', r.capture(person));
  const p0 = r.points();
  // Drawn back from the points: the figure where the points are.
  r.applyTo(person);
  const r2 = new Ragdoll();
  r2.capture(person);
  const p1 = r2.points();
  let err0 = 0;
  for (let i = 0; i < p0.length; i += 3) err0 = Math.max(err0, Math.hypot(p0[i] - p1[i], p0[i + 1] - p1[i + 1], p0[i + 2] - p1[i + 2]));
  ok('drawn: points → joints → points again, standing: within 2 cm', err0 < 0.02, `${(err0 * 100).toFixed(2)} cm`);
  r.knock({ x: 6, y: 0, z: 2 }, 0.8);
  let worst = 0;
  for (let k = 0; k < 150; k++) {
    r.step(1 / 60, { floor: () => 2, water: () => -Infinity, collide: null });
    if (k % 10) continue;
    r.applyTo(person);
    r2.capture(person);
    const a = r.points();
    const b = r2.points();
    for (let i = 0; i < a.length; i += 3) worst = Math.max(worst, Math.hypot(a[i] - b[i], a[i + 1] - b[i + 1], a[i + 2] - b[i + 2]));
  }
  ok('drawn: all through the fall the figure is where the points are (within 5 cm at any joint)', worst < 0.05, `${(worst * 100).toFixed(1)} cm at worst`);
  // Up again: eased, and the walk poses a clean figure after (no leg left twisted).
  const up = new GetUp();
  up.begin(person, 0.6);
  let blending = 0;
  for (let i = 0; i < 60; i++) {
    person.position.set(12, 2, -4);
    person.rotation.set(0, -0.7, 0);
    P.posePerson(person, 1 / 60, { speed: 1.2, air: false, wave: null });
    if (up.apply(person, 1 / 60)) blending++;
  }
  const rig = person.userData.rig;
  const twisted = rig.legs.some((g) => Math.abs(g.leg.rotation.y) + Math.abs(g.leg.rotation.z) + Math.abs(g.knee.rotation.y) + Math.abs(g.knee.rotation.z) > 1e-6)
    || Math.abs(rig.body.rotation.x) + Math.abs(rig.body.rotation.y) + Math.abs(rig.body.rotation.z) > 1e-6 || Math.abs(rig.chest.position.y - RD.RIG.chestY) > 1e-6;
  ok('drawn: getting up is eased over 0.6 s, and the walk after it is the walk (nothing left twisted)', blending >= 30 && blending <= 40 && !up.on && !twisted, `${blending} frames of blend`);
  cleanRig(person);
}

/* ================================================================ KNOCKDOWN */

const EXT = await import(SRC + 'game/extensions.js');
const OF = await import(SRC + 'features/onfoot.js');
const WS = await import(SRC + 'features/wasted.js');
const KD = await import(SRC + 'features/knockdown.js');
const TY = await import(SRC + 'aircraft/types.js');
{
  const exts = Object.fromEntries(EXT.extensions().map((e) => [e.id, e]));
  ok('knockdown: registered after onfoot and wasted (it poses the body after the walk has)', !!exts.knockdown
    && EXT.extensions().findIndex((e) => e.id === 'onfoot') < EXT.extensions().findIndex((e) => e.id === 'knockdown')
    && EXT.extensions().findIndex((e) => e.id === 'wasted') < EXT.extensions().findIndex((e) => e.id === 'knockdown'));
  const type = TY.getAircraft('skylark');
  const ac = {
    pos: new THREE.Vector3(0, 0, -40), quat: new THREE.Quaternion(), vel: new THREE.Vector3(), heading: 90, onGround: true, groundSpeed: 0,
    crashed: false, engineOn: false, starting: 0, agl: 0, stopEngine() { this.engineOn = false; }, startEngine() { this.engineOn = true; },
  };
  const sim = {
    state: 'flying', mode: 'free', aircraft: ac, aircraftType: type, model: null,
    scene: new THREE.Scene(), camera: new THREE.PerspectiveCamera(68, 1.5, 0.4, 60000),
    input: { keys: new Set(), throttleTarget: 0, out: { throttle: 0 }, mouse: { x: 0, y: 0 } },
    hud: { notify() {}, setCoach() {} }, override: null, settings: {}, traffic: [],
    renderer: { domElement: el() },
  };
  // The game's frame, as main.js runs it: WASTED's slow motion wraps it (wasted.js install).
  sim.update = function update(dt) {
    for (const id of ['onfoot', 'wasted', 'knockdown']) if (exts[id] && exts[id].update) exts[id].update(this, dt);
  };
  for (const e of EXT.extensions()) if (['wasted', 'knockdown'].includes(e.id) && e.install) e.install(sim);
  const frame = (dt = 1 / 60) => sim.update(dt);
  const reset = (x = 300, z = 300, hd = 0) => {
    sim.traffic = [];
    KD.knockdown.getUpNow(sim);
    for (const id of ['knockdown', 'wasted']) exts[id].stop(sim, 'test');
    OF.onFoot.end(sim);
    OF.onFoot.start(sim, { x, z, headingDeg: hd, outfit: 'pilot' });
    for (let i = 0; i < 10; i++) frame();
  };
  // A taxiing A320 heading north (-z) along x = 300, the walker 40 m ahead of it on its line.
  const jet = { id: 'traffic-1', typeId: 'a320', pos: new THREE.Vector3(300, 0, 340), heading: 0, speed: 9, onGround: true, agl: 0, vs: 0 };
  const run = (secs, dt = 1 / 60, move = true) => {
    for (let t = 0; t < secs && !KD.knockdown.down; t += dt) {
      if (move) jet.pos.z -= jet.speed * dt;
      frame(dt);
    }
  };
  reset(300, 300 - 2, 90);
  sim.traffic = [jet];
  const w0 = WS.wasted.count;
  run(8);
  const kd = KD.knockdown;
  ok('knockdown: a taxiing A320 runs the pilot down', kd.down && kd.cause === 'traffic', `${kd.cause} after ${Math.round(340 - jet.pos.z)} m`);
  ok('knockdown: ...WASTED on this screen, with what hit you in plain words', WS.wasted.count === w0 + 1 && WS.wasted.active && /taxiing Airbus A320/.test(WS.wasted.words), WS.wasted.words);
  ok('knockdown: ...thrown the way it was going (north), by its own speed', kd.last && kd.last.vel.z < -5, kd.last && JSON.stringify(kd.last.vel));
  ok('knockdown: ...and nobody can walk you while you are down', !!(OF.onFoot.control && OF.onFoot.control.locked));
  for (let i = 0; i < 600 && kd.down; i++) {
    jet.pos.z -= jet.speed / 60;
    frame();
  }
  const w = OF.onFoot.walker;
  ok('knockdown: you get up on your own, beside where you fell, clear of the jet', !kd.down && kd.gotUp && !(OF.onFoot.control && OF.onFoot.control.locked) && Math.hypot(w.x - kd.ragdoll.pelvis.x, w.z - kd.ragdoll.pelvis.z) < 25,
    `${Math.hypot(w.x - kd.ragdoll.pelvis.x, w.z - kd.ragdoll.pelvis.z).toFixed(1)} m from the body`);
  ok('knockdown: ...and nothing can knock you straight back over (a moment’s grace)', kd.immune > 1);

  // Beside its wing tip, a metre clear: it passes.
  reset(300 + 19, 300, 0);
  jet.pos.set(300, 0, 340);
  sim.traffic = [jet];
  const c0 = kd.count;
  run(10);
  ok('knockdown: an A320 taxiing past a metre beyond its wing tip does not', kd.count === c0, `${kd.count - c0} knocks`);
  // Creeping at walking pace or less: a nudge, not a knock.
  reset(300, 300 - 2, 0);
  jet.pos.set(300, 0, 340);
  jet.speed = 1;
  run(45);
  ok('knockdown: one creeping at 1 m/s pushes past, it does not knock you over', kd.count === c0);
  jet.speed = 9;
  // A fighter at 60 m/s, 1 m up, on a machine at 10 fps: no stepping over you between frames.
  const f22 = { id: 'traffic-2', typeId: 'f22', pos: new THREE.Vector3(300, 1, 700), heading: 0, speed: 60, onGround: false, agl: 0.4, vs: 0 };
  reset(300, 300, 0);
  sim.traffic = [f22];
  for (let t = 0; t < 10 && !kd.down; t += 0.1) {
    f22.pos.z -= 60 * 0.1;
    frame(0.1);
  }
  ok('knockdown: a fighter at 60 m/s a metre up, seen at 10 fps, still hits (its path is tested, not just where it is)', kd.down && kd.cause === 'traffic');
  // The pause switch off: knocked over all the same, no WASTED screen.
  reset(300, 300 - 2, 0);
  sim.settings.runawayPlane = false;
  jet.pos.set(300, 0, 340);
  sim.traffic = [jet];
  const w1 = WS.wasted.count;
  const c1 = kd.count;
  run(8);
  ok('knockdown: the pause switch off — knocked down all the same, but no WASTED screen', kd.down && kd.count === c1 + 1 && WS.wasted.count === w1 && !WS.wasted.active);
  for (let i = 0; i < 600 && kd.down; i++) frame();
  ok('knockdown: ...and up again once the body has settled (no screen to wait for)', !kd.down && kd.gotUp);
  sim.settings.runawayPlane = true;
  // A feature's own mover (the runaway plane is one): addMoverSource.
  reset(300, 300, 0);
  sim.traffic = [];
  const cart = { x: 300, y: 0, z: 310, heading: 0, vx: 0, vy: 0, vz: -3, lift: 0, hl: 1.3, hw: 0.8, height: 1.8, kind: 'cart', words: 'Hit by a baggage train.', by: -1 };
  const src = KD.addMoverSource((s, add) => add(cart));
  for (let t = 0; t < 6 && !kd.down; t += 1 / 60) {
    cart.z -= 3 / 60;
    frame();
  }
  KD.removeMoverSource(src);
  ok('knockdown: anything a feature lists can knock you over — a baggage cart at 3 m/s', kd.down && kd.cause === 'cart' && /baggage/.test(kd.words));
  reset(300, 300, 0);
  for (const id of ['knockdown', 'wasted']) exts[id].stop(sim, 'test');
  OF.onFoot.end(sim);
}

/* ===================================================================== WIRE */

const PR = await import(SRC + 'features/multiplayer/protocol.js');
{
  ok('wire: PROTO 4 (the walking pilot changed the snapshot)', PR.PROTO === 4);
  const base = {
    id: 3, seq: 9, t: 1234, pos: { x: 10, y: 2, z: -30 }, quat: { x: 0, y: 0, z: 0, w: 1 }, vel: { x: 0, y: 0, z: 0 },
    game: 'flight', type: 'skylark', onGround: true, engineOn: false,
  };
  const plain = PR.encodeState(base);
  const d0 = PR.decodeState(plain);
  ok('wire: a snapshot with nobody out walking is as it was (and says so)', plain.byteLength === PR.STATE_HEAD + 7 && d0 && d0.walk === null);
  const walk = { x: 123.456, y: 4.06, z: -987.65, heading: 271.3, speed: 5.2, air: true, down: true, wave: false, wading: true, outfit: 'captain', knock: 261 };
  const buf = PR.encodeState({ ...base, walk });
  const d = PR.decodeState(buf);
  ok('wire: out on foot, nineteen bytes more', buf.byteLength === plain.byteLength + PR.WALK_TAIL && PR.WALK_TAIL === 19, `${buf.byteLength} bytes`);
  ok('wire: the walker round trip — where, which way, how fast, in the air, knocked down, paddling, the uniform, which fall',
    d && d.walk && Math.abs(d.walk.x - walk.x) < 0.001 && Math.abs(d.walk.z - walk.z) < 0.001 && Math.abs(d.walk.heading - 271.3) < 0.01 && Math.abs(d.walk.speed - 5.2) < 0.03
      && d.walk.air && d.walk.down && !d.walk.wave && d.walk.wading && d.walk.outfit === 'captain' && d.walk.knock === 5 && d.type === 'skylark' && d.pos.z === -30, JSON.stringify(d && d.walk));
  const bad = [
    (() => { const b = PR.encodeState({ ...base, walk }); new DataView(b).setUint8(PR.STATE_HEAD + 7, 0x41); return b; })(),
    (() => { const b = PR.encodeState({ ...base, walk }); new DataView(b).setFloat32(PR.STATE_HEAD + 8, NaN, true); return b; })(),
    (() => { const b = PR.encodeState({ ...base, walk }); return b.slice(0, b.byteLength - 3); })(),
    (() => { const b = new Uint8Array(plain.byteLength + 5); b.set(new Uint8Array(plain)); return b.buffer; })(),
  ];
  ok('wire: a broken walker tail, a short one or trailing junk: the snapshot is refused', bad.every((b) => PR.decodeState(b) === null));
  const odd = PR.decodeState(PR.encodeState({ ...base, walk: { ...walk, outfit: 'clown' } }));
  ok('wire: an outfit not on the list is drawn as the pilot', odd && odd.walk.outfit === 'pilot');
  const bun = PR.decodeStates(PR.encodeBundle([PR.encodeState({ ...base, id: 1, type: 'b747', walk }), PR.encodeState({ ...base, id: 2, type: 'tempest' }), PR.encodeState({ ...base, id: 4, type: 'a380', walk })]));
  ok('wire: the host’s bundles carry walkers too, eight long type names and all', bun.length === 3 && !!bun[0].walk && bun[1].walk === null && !!bun[2].walk && bun[2].type === 'a380');
}

/* ===================================================================== REMOTE */

const IN = await import(SRC + 'features/multiplayer/interp.js');
const WK = await import(SRC + 'features/multiplayer/walkers.js');
const WALK = await import(SRC + 'features/staff/walk.js');
{
  // A friend walking east at 1.8 m/s, sending fifteen times a second, 40-90 ms late.
  const tr = new IN.Track();
  const rw = new WK.RemoteWalker();
  const root = new THREE.Group();
  const truth = (ms) => ({ x: 1.8 * (ms / 1000), z: 0, y: WALK.floorAt(1.8 * (ms / 1000), 0) });
  let rand = 7;
  const rnd = () => ((rand = (rand * 16807) % 2147483647) / 2147483647);
  const offset = 3000;
  const sends = [];
  for (let t = 0; t <= 8000; t += 1000 / 15) sends.push({ t, at: t + offset + 40 + rnd() * 50 });
  let k = 0;
  let worst = 0;
  let drawnOk = true;
  for (let now = offset + 100; now < offset + 6000; now += 16) {
    while (k < sends.length && sends[k].at <= now) {
      const s = sends[k++];
      const p = truth(s.t);
      tr.push({ t: s.t, pos: { x: 0, y: 0, z: 50 }, quat: { x: 0, y: 0, z: 0, w: 1 }, vel: { x: 0, y: 0, z: 0 }, walk: { x: p.x, y: p.y, z: p.z, heading: 90, speed: 1.8, air: false, down: false, wave: false, outfit: 'captain', knock: 0 } }, s.at);
    }
    drawnOk = rw.update(tr, now, 0.016, root) && drawnOk;
    if (now < offset + 1200) continue;
    const drawnAt = now - tr.offset - tr.delayMs;
    worst = Math.max(worst, Math.abs(rw.x - truth(drawnAt).x));
  }
  ok('remote: a friend’s pilot is drawn walking, between their snapshots, within 15 cm of where they were', drawnOk && rw.on && !!rw.model && worst < 0.15, `${(worst * 100).toFixed(1)} cm at worst`);
  ok('remote: ...in the uniform their aeroplane gives them, walking (the legs move)', rw.model.userData.outfit === 'captain' && rw.model.userData.anim.walk > 0.5);
  // Their fall: the event, then the snapshots say down; then up.
  const pushWalk = (t, at, down, knock) => tr.push({ t, pos: { x: 0, y: 0, z: 50 }, quat: { x: 0, y: 0, z: 0, w: 1 }, vel: { x: 0, y: 0, z: 0 }, walk: { x: rw.x, y: rw.y, z: 0, heading: 90, speed: 0, air: false, down, wave: false, outfit: 'captain', knock } }, at);
  let t = 8100;
  let now = offset + 8200;
  const took = rw.knock({ n: 1, x: rw.x, y: rw.y, z: 0, h: 90, vx: 7, vy: 0, vz: 0, hy: 0.7 });
  let lay = null;
  for (let i = 0; i < 240; i++, now += 16, t += 16) {
    if (i % 4 === 0) pushWalk(t, now, true, 1);
    rw.update(tr, now, 0.016, root);
  }
  lay = rw.rd && rw.rd.height();
  ok('remote: their fall comes from the event, the same ragdoll, here', took && rw.down && !!rw.rd && lay < 0.5 && rw.fromEvent === 1, `lying ${lay && lay.toFixed(2)} m high`);
  for (let i = 0; i < 60; i++, now += 16, t += 16) {
    if (i % 4 === 0) pushWalk(t, now, false, 1);
    rw.update(tr, now, 0.016, root);
  }
  ok('remote: their snapshot says they are up: up they get, eased', !rw.down && !rw.rd);
  // A down with no event (it was lost): they fall where they stand.
  const rw2 = new WK.RemoteWalker();
  const tr2 = new IN.Track();
  for (let i = 0; i < 90; i++) {
    tr2.push({ t: i * 66, pos: { x: 0, y: 0, z: 0 }, quat: { x: 0, y: 0, z: 0, w: 1 }, vel: { x: 0, y: 0, z: 0 }, walk: { x: 5, y: WALK.floorAt(5, 5), z: 5, heading: 0, speed: 0, air: false, down: i > 20, wave: false, outfit: 'pilot', knock: 2 } }, 1000 + i * 66);
    rw2.update(tr2, 1000 + i * 66, 0.066, root);
  }
  ok('remote: a knock-down whose event never came is a fall where they stand', !!rw2.rd && rw2.falls === 1 && rw2.fromEvent === 0 && rw2.rd.height() < 0.6);
  // Back in their ride: the pilot is gone.
  tr2.push({ t: 99 * 66, pos: { x: 0, y: 0, z: 0 }, quat: { x: 0, y: 0, z: 0, w: 1 }, vel: { x: 0, y: 0, z: 0 } }, 1000 + 99 * 66);
  ok('remote: back in their ride, the pilot is not drawn', rw2.update(tr2, 1000 + 99 * 66, 0.066, root) === false && !rw2.on && (!rw2.model || !rw2.model.visible));
}

/* ---- 'pilot:down' on the wire -------------------------------------------- */
{
  const PM = await import(SRC + 'features/pilot-mp.js');
  const good = { n: 3, x: 1.5, y: 2, z: -3, h: 270, vx: 5, vy: 0, vz: -2, hy: 0.7, by: 2 };
  ok('wire: a knock-down travels as numbers and is checked on arrival', !!PM.cleanDown(good) && PM.cleanDown({ ...good, x: 'here' }) === null && PM.cleanDown({ ...good, vx: 900 }) === null
    && PM.cleanDown({ ...good, n: 300 }) === null && PM.cleanDown({ ...good, h: -5 }) === null && PM.cleanDown({ ...good, by: 99 }).by === -1 && PM.cleanDown(null) === null);
  const mp = (await import(SRC + 'features/multiplayer.js')).multiplayer;
  ok('wire: multiplayer asks pilot-mp.js where the pilot is (null in the seat)', typeof mp.walkState === 'function' && mp.walkState() === null);
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length} of ${results.length} passed`);
if (failed.length) {
  console.log('FAILED: ' + failed.map((f) => f.name).join('; '));
  process.exitCode = 1;
}

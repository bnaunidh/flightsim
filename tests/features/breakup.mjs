/**
 * Node checks for the crash physics — the break points, the break-up, the
 * pieces, the handling and the slow sinking. Run with plain node:
 *
 *   node tests/features/breakup.mjs
 *
 *   1. ZONES PER TYPE. Every aircraft in the roster, from its own description
 *      (its `shape`, or the fleet pack's build config when the pack draws it):
 *      the nose, centre and rear sections; inner and outer wing each side;
 *      fin and tailplanes (not on the flying wing); a gear leg each; one
 *      engine zone per engine; on the helicopter the rotor, the boom and the
 *      tail rotor.
 *   2. ON THE DRAWN MODEL. Every type built for real and every triangle
 *      classified: each zone it should have has triangles, and they are where
 *      that zone is (the left outer wing outboard on the left, the fin above
 *      the fuselage, the gear below it) — in good time.
 *   3. NEAREST ZONE. The flight model's own strike points select the zone
 *      they belong to: a wing tip its outer wing, the tail its tail.
 *   4. ENERGY -> ZONES. A wing tip clipping the grass snaps that outer wing
 *      and nothing else; a heavy landing folds the gear; a dive crushes the
 *      nose and a harder one breaks the fuselage; more energy never breaks
 *      less; a grazing blow breaks less than a square one; a survivable knock
 *      only ever takes a survivable piece; nothing of T-Pose Harrison ever
 *      comes off.
 *   5. HANDLING. No damage, no change, to the last bit; a lost wing tip rolls
 *      you towards it, a lost fin lets the yaw go, a lost engine swings the
 *      nose towards it and costs thrust.
 *   6. SPLIT AND PUT BACK. Pieces are new meshes; the model is handed new
 *      geometry without them, never touching the one it was built with, and
 *      restoring is exact.
 *   7. THE PIECES. One at rest on the ground, one sliding on concrete (it
 *      scrapes), one into the sea that floats and drifts (light), one that
 *      sinks — slowly, with bubbles — and stays faintly under.
 *   8. THE AIRFRAME AT SEA. It floats, longer when it is bigger; settles
 *      heavy end first; goes under in 20-60 s; ends a couple of metres down
 *      or on a shallow sea bed. Left up over the water by a dive, it falls
 *      in rather than hanging there; the pilot's raft is always in the water.
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
const B = await imp('game/breakup.js');
const BM = await imp('game/breakup-mesh.js');
const BB = await imp('game/breakup-body.js');
const H = await imp('aircraft/damage-handling.js');
const F = await imp('features/breakup.js');
const I = await imp('flight/input.js');
TER.applyMap(TER.MAP.id);

let pass = 0;
let fail = 0;
function ok(name, cond, detail = '') {
  if (cond) pass++;
  else fail++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail !== '' ? '  — ' + detail : ''}`);
}
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const f1 = (v) => (Math.round(v * 10) / 10).toString();

/* ---- the models, built once ------------------------------------------ */
const built = {};
for (const t of T.AIRCRAFT) {
  const model = A.createAircraftModel({ type: t });
  const config = model.userData.fleetBridge ? model.userData.config : null;
  built[t.id] = { type: t, model, config };
}
const zonesFor = (id, timed = false) => {
  const b = built[id];
  const survey = BM.surveyModel(b.model);
  const frame = B.refineFrame(B.frameFor(b.type, b.config), survey);
  const layout = B.layoutFor(frame);
  // Timed as the best of three: this process holds every aircraft in the
  // game at once, and a garbage collection landing in one run says nothing
  // about the break-up.
  let asg = null;
  let ms = Infinity;
  for (let i = 0; i < (timed ? 3 : 1); i++) {
    const t0 = performance.now();
    asg = BM.classifyModel(survey, layout);
    ms = Math.min(ms, performance.now() - t0);
  }
  return { asg, layout, frame, ms };
};

/* ---- 1. zones per type --------------------------------------------------- */
for (const t of T.AIRCRAFT) {
  const b = built[t.id];
  const zs = B.zonesForType(t, b.config);
  const rotor = !!(t.shape.power && t.shape.power.rotor);
  const person = typeof t.buildModel === 'function';
  const wingOnly = !!t.shape.flyingWing || (b.config && b.config.kind === 'flying-wing');
  const want = ['nose', 'core', 'rear', 'gearL', 'gearR'];
  if (rotor) want.push('rotor', 'tailRotor');
  else want.push('wingInnerL', 'wingOuterL', 'wingInnerR', 'wingOuterR');
  if (!wingOnly) want.push('fin', 'tailplaneL', 'tailplaneR');
  if (!rotor) want.push('gearN');
  const missing = want.filter((z) => !zs.includes(z));
  ok(`zones: ${t.id} has every break zone of its kind`, !missing.length, missing.length ? `missing ${missing.join(', ')}; has ${zs.join(' ')}` : zs.join(' '));
  if (!rotor && !person) {
    const engines = zs.filter((z) => /^engine/.test(z)).length;
    const want2 = b.config ? b.config.engines.length : t.shape.power.count || 1;
    ok(`zones: ${t.id} has one zone per engine (${want2})`, engines === want2 || (want2 === 0 && engines === 0), `${engines}`);
  }
}

/* ---- 2. on the drawn model ----------------------------------------------- */
const drawn = {};
for (const t of T.AIRCRAFT) {
  const z = zonesFor(t.id, true);
  drawn[t.id] = z;
  const { asg, frame } = z;
  const rotor = frame.family === 'rotor';
  const person = frame.family === 'person';
  const has = (id) => (asg.counts[id] || 0) > 0;
  const must = ['nose', 'core', 'rear'];
  if (!rotor && !person) must.push('wingInnerL', 'wingOuterL', 'wingInnerR', 'wingOuterR', 'gearL', 'gearR');
  if (frame.tail && !person) must.push('fin');
  if (rotor) must.push('rotor', 'tailRotor', 'gearL', 'gearR');
  const empty = must.filter((id) => !has(id));
  ok(`drawn: ${t.id} — every zone it should have has triangles`, !empty.length, empty.length ? `empty: ${empty.join(', ')}` : Object.entries(asg.counts).map(([k, v]) => `${k}:${v}`).join(' '));
  const bx = asg.boxes;
  if (!rotor && !person && frame.wing) {
    const sx = frame.wing.splitX;
    ok(`drawn: ${t.id} — the left outer wing is outboard on the left, the right on the right`, bx.wingOuterL.max[0] <= -sx + 0.05 && bx.wingOuterR.min[0] >= sx - 0.05,
      `split ${f1(sx)}; L ${f1(bx.wingOuterL.min[0])}..${f1(bx.wingOuterL.max[0])}, R ${f1(bx.wingOuterR.min[0])}..${f1(bx.wingOuterR.max[0])}`);
    ok(`drawn: ${t.id} — the inner wings are between the fuselage and the split`, bx.wingInnerL.min[0] >= -sx - 0.05 && bx.wingInnerR.max[0] <= sx + 0.05);
  }
  if (bx.fin && !person) {
    const bodyTop = Math.max(...frame.profile.map((p) => p.top));
    ok(`drawn: ${t.id} — the fin stands above the fuselage`, bx.fin.max[1] > bodyTop * 0.9 + 0.1, `fin top ${f1(bx.fin.max[1])}, body top ${f1(bodyTop)}`);
  }
  for (const g of ['gearN', 'gearL', 'gearR']) {
    if (!bx[g] || person) continue;
    ok(`drawn: ${t.id} — ${g} hangs below the fuselage`, bx[g].min[1] < frame.gearTopY + 0.05, `bottom ${f1(bx[g].min[1])} vs ${f1(frame.gearTopY)}`);
  }
  if (rotor) ok(`drawn: ${t.id} — the rotor is the disc on top`, bx.rotor.min[1] > 0.5 && bx.rotor.max[0] - bx.rotor.min[0] > 6, `${f1(bx.rotor.min[1])} up, ${f1(bx.rotor.max[0] - bx.rotor.min[0])} m across`);
  // Generous: this Mac's other work can pause any process for a slice. The
  // number is what to read (5-25 ms here); the bound only catches a blunder.
  ok(`drawn: ${t.id} — classifying (and cutting) every triangle is quick`, z.ms < 250, `${z.ms.toFixed(1)} ms`);
}

/* ---- 3. nearest zone ---------------------------------------------------- */
for (const id of ['skylark', 'meridian', 'vanguard', 'a320', 'b747', 'f22', 'nightjar']) {
  const { asg, layout } = drawn[id];
  const spec = T.specFor(id);
  const hp = (part) => spec.hardPoints.find((h) => h.part === part);
  // Fleet-drawn aeroplanes fly the pack's own strike points (configurePlayerAircraft).
  const g = built[id].model.userData.flightGeometry;
  const fhp = (part) => (g ? g.hardPoints.find((h) => h.partId === part) : null);
  const pt = (part) => (fhp(part) ? fhp(part).pos.slice() : hp(part).pos.toArray());
  const tipL = pt('leftWing');
  const tipR = pt('rightWing');
  if (g) {
    // The pack lists several points per wing; the tip is the outermost.
    tipL[0] = Math.min(...g.hardPoints.filter((h) => h.partId === 'leftWing').map((h) => h.pos[0]));
    tipR[0] = Math.max(...g.hardPoints.filter((h) => h.partId === 'rightWing').map((h) => h.pos[0]));
  }
  const zl = B.nearestZone(layout, asg.boxes, tipL);
  const zr = B.nearestZone(layout, asg.boxes, tipR);
  ok(`nearest: ${id} — the left wing tip's strike point is in the left outer wing`, zl === 'wingOuterL', zl);
  ok(`nearest: ${id} — the right wing tip's strike point is in the right outer wing`, zr === 'wingOuterR', zr);
  const tail = B.nearestZone(layout, asg.boxes, hp('tail').pos.toArray().map((v, i) => (i === 2 ? Math.max(v, asg.boxes.rear.max[2] - 0.5) : v)));
  // A flying wing has no tail: its back edge is wing.
  ok(`nearest: ${id} — the tail strike point is in the tail`, /rear|fin|tailplane|engine/.test(tail) || (layout.family === 'wing' && /wing|rear/.test(tail)), tail);
  const nose = B.nearestZone(layout, asg.boxes, [0, 0, asg.boxes.nose.min[2] - 0.2]);
  ok(`nearest: ${id} — the very front is the nose (or the propeller on it)`, nose === 'nose' || nose === 'engine', nose);
}

/* ---- 4. energy -> zones -------------------------------------------------- */
const plan = (id, hit) => B.planBreak(drawn[id].layout, hit, drawn[id].asg.boxes);
const detached = (p) => p.actions.filter((a) => a.action === 'detach').map((a) => a.zone);
const tipPoint = (id) => {
  const bx = drawn[id].asg.boxes.wingOuterL;
  return [bx.min[0] + 0.2, (bx.min[1] + bx.max[1]) / 2, (bx.min[2] + bx.max[2]) / 2];
};
for (const id of ['skylark', 'meridian', 'vanguard', 'a320', 'tempest']) {
  // A clip: 4 m/s into the ground at the tip, 30 m/s along it.
  const clip = plan(id, { point: tipPoint(id), normal: [0, 1, 0], velocity: [0, -4, -30] });
  const d = detached(clip);
  ok(`energy: ${id} — a wing tip clipping the ground snaps that outer wing, and only that`, d.length === 1 && d[0] === 'wingOuterL' && clip.pieces.length === 1, `E ${f1(clip.energy)}: ${d.join(',') || 'nothing'}; ${clip.actions.map((a) => a.zone + ':' + a.action).join(' ')}`);
  ok(`energy: ${id} — and the zone it hit is the one nearest the contact`, clip.hitZone === 'wingOuterL', clip.hitZone);
  // A heavy landing on the wheels: the gear folds, nothing comes off.
  const belly = drawn[id].asg.boxes.core;
  const land = plan(id, { point: [0, belly.min[1], 0.3], normal: [0, 1, 0], velocity: [0, -5.5, -35], gearDown: 1 });
  const folds = land.actions.filter((a) => a.action === 'fold').map((a) => a.zone);
  ok(`energy: ${id} — a heavy landing folds the main gear and breaks nothing off`, folds.includes('gearL') && folds.includes('gearR') && !detached(land).length, `E ${f1(land.energy)}: ${land.actions.map((a) => a.zone + ':' + a.action).join(' ')}`);
  // A belly landing, fixed gear or wheels up: it scrapes, the legs fold, the
  // propellers that touch bend, and nothing comes off.
  const props = drawn[id].layout.frame.engines.filter((e) => e.prop || e.nose).map((e) => e.id);
  const flop = plan(id, { point: [0, belly.min[1], 0.3], normal: [0, 1, 0], velocity: [0, -4, -42], gearDown: 1 });
  const flopFolds = flop.actions.filter((a) => a.action === 'fold').map((a) => a.zone);
  ok(`energy: ${id} — a belly flop folds the gear, bends the props and takes nothing off`, flopFolds.includes('gearL') && flopFolds.includes('gearR') && !detached(flop).length
    && props.every((z) => flop.actions.some((a) => a.zone === z && a.action === 'bend')), `props ${props.join(',') || 'none'}; ${flop.actions.map((a) => a.zone + ':' + a.action).join(' ')}`);
  // Nose first.
  const noseBox = drawn[id].asg.boxes.nose;
  const front = [0, 0, noseBox.min[2] + 0.1];
  const dive = plan(id, { point: front, normal: [0, 0.6, 0.8], velocity: [0, -14, -20] });
  ok(`energy: ${id} — a nose-first hit crushes the nose`, dive.actions.some((a) => a.zone === 'nose' && (a.action === 'crush' || a.action === 'detach')), dive.actions.map((a) => a.zone + ':' + a.action).join(' '));
  const smash = plan(id, { point: front, normal: [0, 0.3, 0.95], velocity: [0, -30, -60] });
  const ds = detached(smash);
  ok(`energy: ${id} — a much harder one breaks the fuselage into sections`, ds.includes('nose') && ds.includes('rear') && smash.pieces.length >= 3, `E ${f1(smash.energy)}: ${smash.pieces.map((p) => p.join('+')).join(' | ')}`);
  // Monotonic in energy.
  let last = -1;
  let mono = true;
  const counts = [];
  for (const E of [2, 8, 20, 60, 200, 600, 1800]) {
    const p = plan(id, { point: tipPoint(id), normal: [0, 1, 0], energy: E });
    const n = detached(p).length;
    counts.push(n);
    if (n < last) mono = false;
    last = n;
  }
  ok(`energy: ${id} — more energy never breaks less`, mono && counts[counts.length - 1] >= 3, counts.join(' '));
  // A huge hit in the middle takes nearly everything.
  const huge = plan(id, { point: [0, drawn[id].asg.boxes.core.min[1], 0], normal: [0, 1, 0], energy: 3000 });
  ok(`energy: ${id} — a huge hit breaks many zones`, huge.pieces.length >= 6 && detached(huge).length >= 8, `${huge.pieces.length} pieces: ${huge.pieces.map((q) => q.join('+')).join(' | ')}`);
  // Angle: the same speed, square on and grazing.
  const square = plan(id, { point: tipPoint(id), normal: [0, 1, 0], velocity: [0, -25, -5] });
  const graze = plan(id, { point: tipPoint(id), normal: [0, 1, 0], velocity: [0, -3, -25.2] });
  ok(`energy: ${id} — a grazing blow breaks less than a square one at the same speed`, detached(graze).length < detached(square).length, `${detached(graze).length} vs ${detached(square).length}`);
  // Survivable: only what leaves an aeroplane to fly.
  const knock = plan(id, { point: tipPoint(id), normal: [0, 1, 0], energy: 600, survivable: true });
  const bad = detached(knock).filter((z) => !B.ZONES[z].survivable);
  ok(`energy: ${id} — a survivable knock only ever takes a survivable piece`, !bad.length, bad.join(','));
}
for (const id of ['skylark', 'meridian', 'tempest', 'f22', 'f35b', 'fa18', 'massimo', 'a320', 'b747', 'a380', 'nightjar']) {
  // Wheels up at 75 m/s: a long scrape of the belly — the scrape grinds what
  // is down on the runway, it does not travel up into the fin and the tail.
  const spec = T.specFor(id);
  const gp = spec.gearPoints.find((g) => g.pos.x < -0.1) || spec.gearPoints[0];
  const up = plan(id, { point: [gp.pos.x, -0.35, gp.pos.z], normal: [0, 1, 0], velocity: [0, -1.5, -75], gearDown: 0 });
  const big = detached(up).filter((z) => !/^engine/.test(z));
  ok(`scrape: ${id} — a wheels-up landing at 75 m/s takes no fin, tail, wing or fuselage off`, !big.length && !up.actions.some((a) => (a.zone === 'fin' || /^tailplane/.test(a.zone)) && a.action !== 'bend'),
    `E ${f1(up.energy)} (blow ${f1(up.blow)}, scrape ${f1(up.scrape)}): ${up.actions.map((a) => a.zone + ':' + a.action).join(' ')}`);
  ok(`scrape: ${id} — …and the retracted gear folds where it is`, up.actions.some((a) => /^gear/.test(a.zone) && a.action === 'fold' && a.hidden));
}
{
  // The blow still travels: the same wheels-up touch, square at 25 m/s, is a break-up.
  const id = 'f22';
  const spec = T.specFor(id);
  const gp = spec.gearPoints.find((g) => g.pos.x < -0.1);
  const slam = plan(id, { point: [gp.pos.x, -0.35, gp.pos.z], normal: [0, 1, 0], velocity: [0, -25, -40], gearDown: 0 });
  ok('scrape: a wheels-up slam into the ground (25 m/s down) still breaks it up', detached(slam).length >= 3, slam.pieces.map((p) => p.join('+')).join(' | '));
}
{
  // A ventral fin drawn with the fin stays with the rear fuselage.
  const { asg, frame } = drawn.vanguard;
  const body = Math.min(...frame.profile.map((p) => p.bot));
  ok('zones: a ventral fin (vanguard) is part of the rear fuselage, not the fin above', asg.boxes.fin.min[1] > body, `fin bottom ${f1(asg.boxes.fin.min[1])}, belly ${f1(body)}`);
}
{
  // The helicopter: the rotor is the first thing to go, in pieces.
  const id = 'harrier';
  const bx = drawn[id].asg.boxes.rotor;
  const p = plan(id, { point: [bx.max[0], bx.min[1], 0], normal: [-1, 0, 0], velocity: [6, 0, 0] });
  ok('energy: the helicopter — a blade striking something takes the rotor off', detached(p).includes('rotor'), p.actions.map((a) => a.zone + ':' + a.action).join(' '));
  const tr = drawn[id].asg.boxes.tailRotor;
  const p2 = plan(id, { point: [tr.min[0], tr.min[1], tr.max[2]], normal: [0, 1, 0], velocity: [0, -3, -3] });
  ok('energy: the helicopter — a tail rotor strike takes the tail rotor', detached(p2).includes('tailRotor'), p2.actions.map((a) => a.zone + ':' + a.action).join(' '));
}
{
  const p = plan('tpose', { point: tipPoint('tpose'), normal: [0, 1, 0], energy: 2000 });
  ok('energy: T-Pose Harrison — nothing of a person ever comes off or bends', p.actions.every((a) => a.action === 'shake') && !p.pieces.length, p.actions.map((a) => a.zone + ':' + a.action).join(' '));
}

/* ---- 4b. calibration: a knock, a wheels-down landing and a tail strike break what they touched ---- */
// The crash sweep (finding 5 and 8): on a short jet the reach of a blow was the length of the aeroplane, so
// a knock on an engine took the fin and both tailplanes, a knock on a tailplane "hit" the wing and a hard
// wheels-down landing tore the tailplanes and the wing tips off every fighter. Held here for every
// fixed-wing type the game has.
{
  const FIXED = T.AIRCRAFT.filter((t) => {
    const f = drawn[t.id].frame;
    return f.family !== 'rotor' && f.family !== 'person';
  }).map((t) => t.id);
  const TAILS = new Set(['fin', 'tailplaneL', 'tailplaneR']);
  const wingTip = (id, side) => {
    const bx = drawn[id].asg.boxes[side < 0 ? 'wingOuterL' : 'wingOuterR'];
    return [side < 0 ? bx.min[0] + 0.2 : bx.max[0] - 0.2, (bx.min[1] + bx.max[1]) / 2, (bx.min[2] + bx.max[2]) / 2];
  };
  const centre = (b) => [0, 1, 2].map((k) => (b.min[k] + b.max[k]) / 2);
  const tailPoint = (id) => {
    const spec = T.specFor(id);
    const hp = spec.hardPoints.find((h) => h.part === 'tail');
    const bx = drawn[id].asg.boxes;
    return [0, hp.pos.y, Math.max(hp.pos.z, bx.rear.max[2] - 0.5)];
  };
  const names = (p) => detached(p).join('+') || 'nothing';
  for (const id of FIXED) {
    const lay = drawn[id].layout;
    const bx = drawn[id].asg.boxes;
    const has = (z) => !!bx[z];
    // A knock on a wing tip (severity 0.6, what the Dev button does): that outer wing, and nothing else.
    for (const side of [-1, 1]) {
      const z = side < 0 ? 'wingOuterL' : 'wingOuterR';
      if (!has(z)) continue;
      const k = plan(id, { point: wingTip(id, side), normal: [0, 1, 0], energy: 24, survivable: true, zones: side < 0 ? ['wingOuterL', 'wingInnerL'] : ['wingOuterR', 'wingInnerR'] });
      ok(`calibration: ${id} — a knock on the ${side < 0 ? 'left' : 'right'} wing tip takes that tip and nothing else`, detached(k).length === 1 && detached(k)[0] === z, names(k));
    }
    // A knock on the tail takes tail, never a wing or an engine.
    if (has('fin') || has('tailplaneL')) {
      const k = plan(id, { point: tailPoint(id), normal: [0, 1, 0], energy: 24, survivable: true, zones: ['fin', 'tailplaneL', 'tailplaneR', 'rear'] });
      ok(`calibration: ${id} — a knock on the tail takes only tail`, detached(k).every((z) => TAILS.has(z)), names(k));
    }
    // A knock on an engine takes engines, not the fin and the tailplanes.
    for (const z of lay.zones.filter((q) => /^engine/.test(q))) {
      const k = plan(id, { point: centre(bx[z]), normal: [0, 1, 0], energy: 24, survivable: true });
      ok(`calibration: ${id} — a knock on ${z} takes engines only`, detached(k).every((q) => /^engine/.test(q)), names(k));
    }
    // A hard landing on the wheels (6 m/s down at 55 m/s along: twelve hundred feet a minute) bends things and folds
    // a leg, and tears nothing off.
    const spec = T.specFor(id);
    const gp = spec.gearPoints.filter((g) => g.pos.x > 0.1).sort((a, b) => b.pos.z - a.pos.z)[0] || spec.gearPoints[0];
    const land = plan(id, { point: [gp.pos.x, gp.pos.y - 0.3, gp.pos.z], normal: [0, 1, 0], velocity: [0, -6, -55], gearDown: 1 });
    ok(`calibration: ${id} — a 6 m/s landing on the wheels tears nothing off (no leg, tip, tailplane or fin)`, detached(land).length === 0, names(land));
    // ...and at 8 m/s a leg may fold, but the legs still hold and the fin stays on.
    const land8 = plan(id, { point: [gp.pos.x, gp.pos.y - 0.3, gp.pos.z], normal: [0, 1, 0], velocity: [0, -8, -55], gearDown: 1 });
    ok(`calibration: ${id} — a 8 m/s one folds a leg and keeps the legs and the fin`, !detached(land8).some((z) => /^gear|^fin$/.test(z)), names(land8));
    // A tail strike is the tail, on both sides: both tailplanes or neither, never one.
    if (has('tailplaneL') && has('tailplaneR')) {
      for (const v of [3.5, 6, 9]) {
        const k = plan(id, { point: tailPoint(id), normal: [0, 1, 0], velocity: [0, -v, -50], gearDown: 1, zones: ['rear'] });
        const d = new Set(detached(k));
        ok(`calibration: ${id} — a tail strike at ${v} m/s breaks both tailplanes or neither`, d.has('tailplaneL') === d.has('tailplaneR') && k.hitZone === 'rear', `${names(k)} (hit ${k.hitZone})`);
      }
    }
  }
  const harrier = T.AIRCRAFT.find((t) => drawn[t.id].frame.family === 'rotor');
  if (harrier) {
    const k = plan(harrier.id, { point: centre(drawn[harrier.id].asg.boxes.tailRotor), normal: [0, 1, 0], velocity: [0, -3, -3], zones: ['rear'] });
    ok('calibration: a helicopter\'s tail strike is still its tail rotor (the zone hint is for aeroplanes)', detached(k).includes('tailRotor'), names(k));
  }
}

/* ---- 5. handling ------------------------------------------------------------ */
ok('handling: no damage and nothing lost is null — the flight model skips every term', H.handlingFor({ leftWing: 0, rightWing: 0, nose: 0, tail: 0, fuselage: 0, gear: 0 }, null) === null
  && H.handlingFor({ leftWing: 0, rightWing: 0, nose: 0, tail: 0, fuselage: 0, gear: 0 }, { engines: [], engineCount: 2 }) === null);
const weather = {
  windVector: (o) => (o || new THREE.Vector3()).set(3, 0, -2),
  gustVector: (o) => (o || new THREE.Vector3()).set(0, 0, 0),
  turbulenceLevel: () => 0,
  cond: { rain: 0, cloud: 0 },
  time_s: 0,
  downdraft: 0,
  vortex: null,
};
function fly(id, setup, seconds = 12, ctrl = null) {
  P.applyAircraft(id);
  const ac = new P.Aircraft();
  ac.mode = 'realistic';
  ac.reset({ pos: V(-1500, 0, 0), headingDeg: 90, speed: id === 'skylark' ? 50 : 110, altAGL: 600, engineOn: true });
  if (setup) setup(ac);
  let maxBeta = 0;
  for (let f = 0; f < seconds * 60; f++) {
    const t = f / 60;
    ac.controls.throttle = 0.75;
    ac.controls.pitch = ctrl ? ctrl.pitch : 0.15 * Math.sin(t * 0.9);
    ac.controls.roll = ctrl ? ctrl.roll : 0.2 * Math.sin(t * 0.5);
    ac.controls.yaw = ctrl ? ctrl.yaw : 0.1 * Math.sin(t * 1.3);
    ac.update(1 / 120, weather);
    ac.update(1 / 120, weather);
    maxBeta = Math.max(maxBeta, Math.abs(ac.beta));
    if (ac.crashed) break;
  }
  return { ac, maxBeta, state: [...ac.pos.toArray(), ...ac.quat.toArray(), ...ac.vel.toArray(), ...ac.omega.toArray()] };
}
for (const id of ['skylark', 'meridian', 'vanguard', 'harrier']) {
  const a = fly(id, null);
  const b = fly(id, (ac) => {
    ac.lost = { engines: [], engineCount: 2 };
  });
  ok(`handling: ${id} — an undamaged flight is the same flight to the last bit, with or without an (empty) record`, a.state.every((v, i) => Object.is(v, b.state[i])), a.state.slice(0, 3).map(f1).join(','));
}
{
  const hold = { pitch: 0, roll: 0, yaw: 0 };
  const bank = (ac) => {
    const r = V(1, 0, 0).applyQuaternion(ac.quat);
    return Math.asin(Math.max(-1, Math.min(1, r.y))) * 57.3; // + right wing up = banked left
  };
  const base = fly('meridian', null, 3, hold);
  const tipL = fly('meridian', (ac) => {
    ac.lost = { wingOuterL: true, engines: [], engineCount: 2 };
  }, 3, hold);
  ok('handling: a lost left wing tip rolls you to the left', bank(tipL.ac) - bank(base.ac) > 5, `bank ${f1(bank(base.ac))} -> ${f1(bank(tipL.ac))} (+ is left wing down)`);
  const tipR = fly('meridian', (ac) => {
    ac.lost = { wingOuterR: true, engines: [], engineCount: 2 };
  }, 3, hold);
  ok('handling: a lost right wing tip rolls you to the right', bank(tipR.ac) - bank(base.ac) < -5, `bank ${f1(bank(tipR.ac))}`);
  const yawCtl = { pitch: 0, roll: 0, yaw: 0.35 };
  const finBase = fly('meridian', null, 6, yawCtl);
  const noFin = fly('meridian', (ac) => {
    ac.lost = { fin: true, engines: [], engineCount: 2 };
  }, 6, yawCtl);
  ok('handling: no fin and the yaw is no longer held — the slip runs away', noFin.maxBeta > finBase.maxBeta * 1.5, `max sideslip ${f1(finBase.maxBeta * 57.3)}° -> ${f1(noFin.maxBeta * 57.3)}°`);
  const hdg = (ac) => ac.heading;
  const engBase = fly('meridian', null, 4, hold);
  const engL = fly('meridian', (ac) => {
    ac.lost = { engines: [{ id: 'engineL', x: -5.7 }], engineCount: 2 };
  }, 4, hold);
  const dh = ((hdg(engL.ac) - hdg(engBase.ac) + 540) % 360) - 180;
  ok('handling: a lost left engine swings the nose left', dh < -2, `${f1(dh)}° of heading`);
  ok('handling: and costs thrust — the aeroplane is slower', engL.ac.airspeed < engBase.ac.airspeed - 1, `${f1(engBase.ac.airspeed)} -> ${f1(engL.ac.airspeed)} m/s`);
  // The helicopter in a hover: no tail rotor and she turns round on the spot,
  // the pedals hardly answer; with it, she holds her heading.
  const hover = (lost, yaw = 0) => {
    P.applyAircraft('harrier');
    const ac = new P.Aircraft();
    ac.mode = 'simplified';
    ac.reset({ pos: V(-1500, 0, 0), headingDeg: 90, speed: 0, altAGL: 300, engineOn: true });
    ac.rpm = 1;
    if (lost) ac.lost = lost;
    const h0 = ac.heading;
    let turned = 0;
    let last = h0;
    for (let f = 0; f < 4 * 60; f++) {
      ac.controls.throttle = 0.6;
      ac.controls.pitch = 0;
      ac.controls.roll = 0;
      ac.controls.yaw = yaw;
      ac.update(1 / 120, weather);
      ac.update(1 / 120, weather);
      turned += ((ac.heading - last + 540) % 360) - 180;
      last = ac.heading;
    }
    return turned;
  };
  const heliBase = hover(null);
  const heliGone = hover({ fin: true, tailRotor: true, engines: [], engineCount: 1 });
  // Full pedal against the turn (whichever way that is): the smaller of the two.
  const heliPedal = [1, -1].map((y) => hover({ fin: true, tailRotor: true, engines: [], engineCount: 1 }, y)).sort((a, b) => Math.abs(a) - Math.abs(b))[0];
  ok('handling: a helicopter that loses its tail rotor turns round on the spot', Math.abs(heliGone) > 60 && Math.abs(heliBase) < 15, `${f1(heliBase)}° -> ${f1(heliGone)}° in 4 s`);
  ok('handling: …and full pedal no longer stops it', Math.abs(heliPedal) > 30, `${f1(heliPedal)}° with full pedal against it`);
  ok('handling: lostFrom marks a lost tail rotor (and its fin)', (() => {
    const { layout } = drawn.harrier;
    const l = B.lostFrom(layout, { pieces: [['tailRotor']], actions: [] });
    return l.tailRotor && l.fin;
  })());
  const h = H.handlingFor({ leftWing: 0.4, rightWing: 0, nose: 0.2, tail: 0.3, fuselage: 0.1, gear: 0 }, null);
  ok('handling: the old damage model is the same numbers as before (lift, drag, thrust, tail, roll)', Math.abs(h.lift - (1 - 0.2 * 0.34)) < 1e-12 && Math.abs(h.drag - (0.2 * 0.05 + 0.2 * 0.03 + 0.3 * 0.02 + 0.1 * 0.04)) < 1e-12
    && Math.abs(h.thrust - (1 - 0.2 * 0.55)) < 1e-12 && Math.abs(h.pitchAuth - (1 - 0.3 * 0.62)) < 1e-12 && Math.abs(h.roll - 0.4 * 0.025) < 1e-12);
}

/*
 * SURVIVABLE MEANS FLYABLE. The checker's finding (v62): a snapped tip rolled
 * 0.035 + 0.025 x the wing asymmetry of Cl, more than the full aileron of the
 * types heavy in roll (Tempest 0.040, Meridian 0.046) — full opposite stick on
 * the Tempest still drifted from -4 to -19 degrees of bank in 8 s, and easy
 * flying's leveller let every type go 35-55 degrees in the first second.
 */
{
  const tipLost = { wingOuterL: true, engines: [], engineCount: 2 };
  const worstKnock = { leftWing: 0.75, rightWing: 0, nose: 0, tail: 0, fuselage: 0, gear: 0 };
  const over = [];
  for (const t of T.AIRCRAFT) {
    P.applyAircraft(t.id);
    const h = H.handlingFor(worstKnock, tipLost, P.SPEC);
    if (Math.abs(h.roll) > H.ROLL_SHARE_MAX * P.SPEC.Clda + 1e-12) over.push(`${t.id} ${h.roll.toFixed(3)} > ${(H.ROLL_SHARE_MAX * P.SPEC.Clda).toFixed(3)}`);
  }
  ok(`handling: a lost tip (and the hardest knock) never rolls harder than ${H.ROLL_SHARE_MAX} of the type's own full aileron — every type`, !over.length && H.ROLL_SHARE_MAX <= 0.7, over.join('; '));
  const bankL = (ac) => Math.asin(Math.max(-1, Math.min(1, V(1, 0, 0).applyQuaternion(ac.quat).y))) * 57.3; // + left wing down
  const still = {
    windVector: (o) => (o || new THREE.Vector3()).set(0, 0, 0),
    gustVector: (o) => (o || new THREE.Vector3()).set(0, 0, 0),
    turbulenceLevel: () => 0,
    cond: { rain: 0, cloud: 0 },
    time_s: 0,
    downdraft: 0,
    vortex: null,
  };
  // The checker's run: a tip knocked off at 0.6 of the knock scale, wings level
  // at a cruise, 8 s, height held with the elevator; the roll is the pilot's.
  const tipFlight = (id, mode, roll) => {
    P.applyAircraft(id);
    const S = P.SPEC;
    const ac = new P.Aircraft();
    ac.mode = mode;
    ac.reset({ pos: V(-1500, 0, 0), headingDeg: 90, speed: Math.max(30, Math.min(0.5 * S.vne, 80)), altAGL: 1500, engineOn: true });
    ac.gearDown = false;
    ac.gearPos = 0;
    ac.damage.leftWing = 0.6;
    ac.lost = { ...tipLost };
    const y0 = ac.pos.y;
    let worst = 0;
    let end = 0;
    for (let f = 0; f < 8 * 60; f++) {
      ac.controls.throttle = 0.7;
      ac.controls.pitch = Math.max(-0.5, Math.min(0.5, 0.08 * ((y0 - ac.pos.y) * 0.1 - ac.vs)));
      ac.controls.roll = roll;
      ac.controls.yaw = 0;
      ac.update(1 / 120, still);
      ac.update(1 / 120, still);
      end = bankL(ac);
      if (Math.abs(end) > Math.abs(worst)) worst = end;
      if (ac.crashed) break;
    }
    return { worst, end, crashed: ac.crashed };
  };
  // The slow-rolling ones (the fighters roll so fast a held stick is a roll, not a hold).
  const heavy = T.AIRCRAFT.filter((t) => {
    P.applyAircraft(t.id);
    return !P.SPEC.rotor && t.id !== 'tpose' && P.SPEC.Clda < 0.12;
  }).map((t) => t.id);
  const cant = [];
  const leans = [];
  for (const id of heavy) {
    const held = tipFlight(id, 'realistic', 0.75);
    if (!(held.end < 3) || held.crashed) cant.push(`${id} ${f1(held.end)}°`);
    const easy = tipFlight(id, 'simplified', 0);
    leans.push(`${id} ${f1(easy.worst)}`);
    if (!(easy.worst > 0.5 && easy.worst < 10) || easy.crashed) cant.push(`${id} hands-off ${f1(easy.worst)}°`);
  }
  ok(`handling: a lost tip can be held — 75% of the stick against it wins on every slow-rolling aeroplane (${heavy.length})`, heavy.length >= 9 && !cant.some((c) => !/hands-off/.test(c)), cant.filter((c) => !/hands-off/.test(c)).join('; '));
  ok('handling: easy flying, hands off — she leans a few degrees towards the lost tip and holds there (no 35-55° roll)', !cant.some((c) => /hands-off/.test(c)), leans.join(', '));
}

/* ---- 6. split and put back ------------------------------------------------ */
const triTotal = (model) => {
  let n = 0;
  model.traverse((o) => {
    if (o.isMesh && !o.isInstancedMesh && o.geometry && o.geometry.attributes.position) n += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3;
  });
  return n;
};
for (const id of ['skylark', 'a320', 'harrier', 'vanguard']) {
  const { model } = built[id];
  const before = new Map();
  model.traverse((o) => {
    if (o.isMesh) before.set(o, o.geometry);
  });
  const t0 = triTotal(model);
  const { asg, layout } = zonesFor(id);
  const which = layout.family === 'rotor' ? [['rotor'], ['tailRotor']] : [['wingOuterL'], ['fin']];
  const pieces = BM.breakZones(asg, which, { rotorBlades: 4 });
  BM.deformZones(asg, [{ zone: 'nose', action: 'crush', amount: 0.8 }], { point: [0, 0, -5], normal: [0, 1, 0] });
  const again = BM.classifyModel(BM.surveyModel(model), layout, { cut: false });
  const left = which.flat().filter((z) => (again.counts[z] || 0) > 0);
  const shared = [];
  for (const p of pieces) p.group.traverse((o) => {
    if (o.isMesh && !o.isInstancedMesh && [...before.values()].includes(o.geometry)) shared.push(o.name);
  });
  ok(`split: ${id} — ${which.flat().join(' and ')} come off as pieces of their own`, pieces.length >= 2 && pieces.every((p) => p.tris > 0), pieces.map((p) => `${p.zones.join('+')}:${p.tris}`).join(' '));
  ok(`split: ${id} — the pieces have geometry of their own, never the model's`, !shared.length, shared.join(','));
  ok(`split: ${id} — nothing of them is left on the model`, !left.length, left.map((z) => `${z}:${again.counts[z]}`).join(' '));
  let swapped = 0;
  for (const [o, g] of before) if (o.geometry !== g) swapped++;
  ok(`split: ${id} — the model's meshes were handed new geometry, not edited`, swapped > 0 && [...before.values()].every((g) => !g.userData.breakupCut));
  BM.restoreModel(model);
  let wrong = 0;
  for (const [o, g] of before) if (o.geometry !== g) wrong++;
  ok(`split: ${id} — putting it back is exact: every mesh has the geometry it was built with`, !wrong && triTotal(model) === t0 && !BM.isBroken(model), `${wrong} wrong, ${triTotal(model)} of ${t0}`);
  for (const p of pieces) BM.disposePiece(p.group);
  if (layout.family === 'rotor') ok(`split: ${id} — a rotor breaks into its blades`, pieces.filter((p) => p.rotorBlade).length >= 2, `${pieces.filter((p) => p.rotorBlade).length} blades`);
}
{
  // A low-poly wing whose triangles run root to tip breaks on a clean line.
  const { asg, layout, frame } = zonesFor('vanguard');
  const pieces = BM.breakZones(asg, [['wingOuterL']]);
  const box = new THREE.Box3().setFromObject(pieces[0].group);
  const width = box.max.x - box.min.x;
  const want = frame.wing.tipX - frame.wing.splitX;
  ok('split: a low-poly wing is cut along the break line, not torn off in slivers', Math.abs(width - want) < 0.35, `piece ${f1(width)} m wide, the outer wing ${f1(want)} m`);
  BM.restoreModel(built.vanguard.model);
  for (const p of pieces) BM.disposePiece(p.group);
  void layout;
}
/* An airliner's cabin windows are instanced — one draw per breakaway piece —
 * and the fleet's windscreen, doors and decals are meshes of their own laid
 * on the skin. A crushed nose, a bent tail cone and the rippled core must take
 * all of it with them, or the panes hang in the air where the skin was. Read
 * as the game would see it: after the deform every pane is within 0.3 m of a
 * visible skin triangle, the panes of a deformed zone really moved, and
 * restoreModel puts every copy back to the last bit. */
const paneFit = (model) => {
  model.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(model.matrixWorld).invert();
  const rel = new THREE.Matrix4();
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const shelf = new Map();
  const slot = (z) => Math.floor(z / 2);
  model.traverse((o) => {
    if (!o.isMesh || o.isInstancedMesh || !o.visible || !o.material || o.material.name !== 'Airliner_livery' || /^Door/.test(o.name)) return;
    rel.multiplyMatrices(inv, o.matrixWorld);
    const pos = o.geometry.attributes.position;
    const idx = o.geometry.index;
    const n = idx ? idx.count : pos.count;
    for (let i = 0; i < n; i += 3) {
      a.fromBufferAttribute(pos, idx ? idx.getX(i) : i).applyMatrix4(rel);
      b.fromBufferAttribute(pos, idx ? idx.getX(i + 1) : i + 1).applyMatrix4(rel);
      c.fromBufferAttribute(pos, idx ? idx.getX(i + 2) : i + 2).applyMatrix4(rel);
      const t = new THREE.Triangle(a.clone(), b.clone(), c.clone());
      for (let k = slot(Math.min(a.z, b.z, c.z)); k <= slot(Math.max(a.z, b.z, c.z)); k++) {
        if (!shelf.has(k)) shelf.set(k, []);
        shelf.get(k).push(t);
      }
    }
  });
  const tmp = new THREE.Vector3();
  const m = new THREE.Matrix4();
  let worst = 0;
  let panes = 0;
  model.traverse((o) => {
    if (!o.isInstancedMesh || o.name !== 'Cabin window rows') return;
    rel.multiplyMatrices(inv, o.matrixWorld);
    for (let i = 0; i < o.count; i++) {
      o.getMatrixAt(i, m);
      if (m.elements[0] === 0 && m.elements[5] === 0) continue; // zeroed: its zone has gone
      a.setFromMatrixPosition(m.premultiply(rel));
      let best = Infinity;
      const k0 = slot(a.z);
      for (let k = k0 - 1; k <= k0 + 1; k++) for (const t of shelf.get(k) || []) best = Math.min(best, t.closestPointToPoint(a, tmp).distanceTo(a));
      worst = Math.max(worst, best);
      panes++;
    }
  });
  return { worst, panes };
};
for (const id of ['a320', 'b747', 'a380']) {
  const { model } = built[id];
  const { asg } = zonesFor(id);
  const rows = asg.items.filter((it) => it.e.kind === 'instanced' && it.e.obj.name === 'Cabin window rows');
  const before = rows.map((it) => it.e.obj.instanceMatrix.array.slice());
  const fit0 = paneFit(model);
  const actions = [{ zone: 'nose', action: 'crush', amount: 0.8 }, { zone: 'rear', action: 'bend', amount: 0.7 }, { zone: B.CORE, action: 'crush', amount: 0.6 }];
  const moved = BM.deformZones(asg, actions, { point: [0, -1, -5], normal: [0, 1, 0] });
  const fit = paneFit(model);
  // Per zone: how many panes it has, and how many of them moved.
  const tally = actions.map(({ zone }) => {
    const idx = asg.index.get(zone);
    let has = 0;
    let went = 0;
    rows.forEach((it, r) => {
      for (let k = 0; k < it.e.obj.count; k++) {
        if (it.zone[k] !== idx) continue;
        has++;
        const now = it.e.obj.instanceMatrix.array;
        for (let j = 0; j < 16; j++) if (now[k * 16 + j] !== before[r][k * 16 + j]) { went++; break; }
      }
    });
    return { zone, has, went };
  });
  ok(`panes: ${id} — crushed nose, bent tail cone, rippled core: every cabin window pane is still on the skin (worst ${f1(fit.worst * 100)} cm of ${fit.panes}; intact ${f1(fit0.worst * 100)} cm)`,
    rows.length >= 1 && fit.panes === fit0.panes && fit.panes > 40 && fit0.worst < 0.1 && fit.worst <= 0.3 && moved > 0,
    tally.map((t) => `${t.zone}: ${t.went} of ${t.has} panes moved`).join(', '));
  ok(`panes: ${id} — the panes of every deformed zone moved with it`, tally.every((t) => t.has === 0 || t.went === t.has) && tally.some((t) => t.has > 0),
    tally.map((t) => `${t.zone}: ${t.went} of ${t.has}`).join(', '));
  BM.restoreModel(model);
  const back = rows.every((it, r) => it.e.obj.instanceMatrix.array.every((v, j) => v === before[r][j]));
  ok(`panes: ${id} — restoreModel puts every pane back exactly`, back && !BM.isBroken(model));
}
/* In the game both systems touch the panes. The fleet pack's airliner crushes
 * its own skin — and moves its own panes with it — in the game's crash entry
 * BEFORE the break-up surveys it, so the break-up's record holds the pack's
 * crushed panes; and main.js puts a new flight's model back in this order:
 * the pack's reset (syncAircraftModel), then the features' update (the
 * break-up's). Restoring the break-up's record alone would write the crushed
 * panes back over the pack's reset. The feature's putBack runs the pack's
 * reset again after its own. */
{
  const type = T.getAircraft('a320');
  const model = A.createAircraftModel({ type });
  const scene = new THREE.Scene();
  scene.add(model);
  model.position.set(0, 14, 0);
  model.updateMatrixWorld(true);
  const rows = [];
  model.traverse((o) => {
    if (o.isInstancedMesh && o.name === 'Cabin window rows') rows.push(o);
  });
  const asBuilt = rows.map((o) => o.instanceMatrix.array.slice());
  const same = () => rows.every((o, r) => o.instanceMatrix.array.every((v, j) => v === asBuilt[r][j]));
  const ac = { pos: model.position.clone(), quat: model.quaternion.clone(), vel: new THREE.Vector3(0, -1, -70), omega: new THREE.Vector3(), crashed: true, controls: {} };
  const crashIt = () => {
    ac.crashed = true;
    A.crashAircraftModel(model, ac, { reason: 'Hit the ground', worldVelocity: ac.vel.clone(), worldAngularVelocity: new THREE.Vector3(), worldPoint: model.position.clone() }, { groundHeight: 0 });
    const packMoved = !same();
    const asg = F.breakupDebug().zonesOf(model, type);
    BM.deformZones(asg, [{ zone: 'nose', action: 'crush', amount: 0.8 }, { zone: B.CORE, action: 'crush', amount: 0.6 }], { point: [0, -1, -5], normal: [0, 1, 0] });
    return packMoved;
  };
  // What restoring the record alone leaves, in main.js's order.
  const packMoved = crashIt();
  ac.crashed = false;
  model.userData.resetDamage();
  BM.restoreModel(model);
  const aloneBack = same();
  // The same crash again, put back the feature's way.
  model.userData.resetDamage();
  const packMoved2 = crashIt();
  ac.crashed = false;
  model.userData.resetDamage();
  F.breakupDebug().putBack(model);
  ok("panes: a new flight in the pack's airliner has its windows as built — the break-up's restore followed by the pack's own reset, in the order main.js runs them",
    rows.length >= 1 && packMoved && packMoved2 && same() && !BM.isBroken(model) && !model.userData.gameCrash,
    `the pack moved the panes in the crash: ${packMoved}; the record alone put them back as built: ${aloneBack}`);
  model.userData.dispose();
  model.removeFromParent();
}

/* ---- 7. the pieces ------------------------------------------------------------ */
function drop(opts, kind, secs) {
  const ev = { scrape: 0, impact: 0, splash: 0, bubble: 0 };
  const env = {
    surface: (x, z, o) => Object.assign(o, { y: kind === 'water' ? 0 : 2, nx: 0, ny: 1, nz: 0, kind, floor: -40 }),
    onScrape: () => ev.scrape++,
    onImpact: () => ev.impact++,
    onSplash: () => ev.splash++,
    onBubble: () => ev.bubble++,
  };
  const b = BB.makeBody(opts);
  let t = 0;
  let sunkAt = null;
  let afloat5 = null;
  for (; t < secs && !b.sleeping; t += 1 / 60) {
    BB.stepBody(b, 1 / 60, env);
    if (afloat5 === null && t >= 5) afloat5 = b.pos.y > -b.size.y * 0.5;
    if (b.sunk && sunkAt === null) sunkAt = t;
  }
  return { b, t, ev, sunkAt, afloat5 };
}
{
  const r = drop({ position: V(0, 12, 0), size: V(2, 0.3, 1), mass: 120, omega: V(1, 2, 3) }, 'ground', 20);
  ok('pieces: one dropped on the ground comes to rest on it', r.b.sleeping && Math.abs(r.b.pos.y - 2.15) < 0.4 && r.ev.impact > 0, `asleep ${r.b.sleeping} at ${f1(r.b.pos.y)} m after ${f1(r.t)} s`);
  const s = drop({ position: V(0, 3, 0), size: V(6, 0.3, 1.5), mass: 200, velocity: V(0, -3, -40), omega: V(0.5, 4, 2) }, 'paved', 20);
  ok('pieces: one sliding on concrete scrapes (sparks) and stops', s.b.sleeping && s.ev.scrape > 10 && s.b.pos.z < -40, `${s.ev.scrape} scrapes, ${f1(-s.b.pos.z)} m`);
  const f = drop({ position: V(0, 6, 0), size: V(3, 0.3, 1.2), mass: 80, velocity: V(0, -8, -30), float: 1.7, light: true }, 'water', 40);
  ok('pieces: light debris splashes in, floats and drifts', f.ev.splash === 1 && !f.b.sunk && f.b.pos.y > -0.5 && Math.hypot(f.b.vel.x, f.b.vel.z) > 0.05, `y ${f1(f.b.pos.y)}, drifting ${f.b.vel.length().toFixed(2)} m/s`);
  const k = drop({ position: V(0, 6, 0), size: V(1.2, 1.2, 3), mass: 600, velocity: V(0, -8, -30), float: 1.3 }, 'water', 120);
  ok('pieces: an engine floats a little, then sinks SLOWLY, with bubbles', k.afloat5 && k.sunkAt > 10 && k.sunkAt < 70 && k.ev.bubble > 10, `afloat at 5 s ${k.afloat5}, under at ${f1(k.sunkAt)} s, ${k.ev.bubble} bubbles`);
  ok('pieces: and stays just under the surface, faintly there', k.b.pos.y < -2 && k.b.pos.y > -6, `${f1(k.b.pos.y)} m`);
  const big = drop({ position: V(0, 3, 0), size: V(6, 6, 38), mass: 18000, velocity: V(0, -3, -20), float: 1.4, heavy: -1 }, 'water', 160);
  ok('pieces: an airliner\'s hull floats far longer than an engine, and still goes down within a minute', big.sunkAt > k.sunkAt + 15 && big.sunkAt < 75, `under at ${f1(big.sunkAt)} s`);
  /*
   * Hard in: a crash into the sea throws its pieces in at the airframe's own
   * speed. They used to plough ten metres down on the momentum, be frozen
   * "sunk" under 2.2 m of water inside a second and half, light wing tips
   * and gear legs included, and be culled: nothing floated, nothing sank
   * slowly (the crash sweep, finding 2). Fast in, a heavy piece plunges a
   * couple of metres, bobs back, floats for its air and goes down slowly; a
   * light one comes back up and floats for good.
   */
  const plunge = (opts, secs = 120) => {
    const env = { surface: (x, z, o) => Object.assign(o, { y: 0, nx: 0, ny: 1, nz: 0, kind: 'water', floor: -40 }), onSplash() {}, onBubble() {} };
    const b = BB.makeBody(opts);
    let deepest = 0;
    let sunkAt = null;
    let y3 = null;
    let y6 = null;
    let t = 0;
    for (; t < secs && !b.sleeping; t += 1 / 60) {
      BB.stepBody(b, 1 / 60, env);
      deepest = Math.min(deepest, b.pos.y);
      if (y3 === null && t >= 3) y3 = b.pos.y;
      if (y6 === null && t >= 6) y6 = b.pos.y;
      if (b.sunk && sunkAt === null) sunkAt = t;
    }
    return { b, deepest, sunkAt, y3, y6, t };
  };
  for (const speed of [40, 60]) {
    const eng = plunge({ position: V(0, 3, 0), size: V(1.2, 1.2, 3), mass: 600, velocity: V(0, -speed * 0.5, -speed), float: 1.3 });
    ok(`pieces: an engine thrown into the sea at ${speed} m/s plunges a few metres at most, and is bobbing at the surface again by 6 s`, eng.deepest > -6 && eng.y6 > -1.2, `deepest ${f1(eng.deepest)} m, ${f1(eng.y6)} m at 6 s`);
    ok(`pieces: …it is not "sunk" in the first ten seconds, and still goes down slowly in the end`, eng.sunkAt > 10 && eng.sunkAt < 75, `under at ${f1(eng.sunkAt)} s`);
    const tip = plunge({ position: V(0, 3, 0), size: V(3, 0.3, 1.2), mass: 80, velocity: V(0, -speed * 0.5, -speed), float: 1.7, light: true }, 60);
    ok(`pieces: a wing tip thrown in at ${speed} m/s comes back up and floats for good (never sunk)`, tip.sunkAt === null && tip.y6 > -0.8 && tip.b.pos.y > -0.8, `${f1(tip.y6)} m at 6 s, ${f1(tip.b.pos.y)} m at ${f1(tip.t)} s, deepest ${f1(tip.deepest)} m`);
    const leg = plunge({ position: V(0, 3, 0), size: V(0.2, 1.4, 0.2), mass: 25, velocity: V(0, -speed * 0.5, -speed), float: 1.7, light: true }, 60);
    ok(`pieces: …and so does a gear leg`, leg.sunkAt === null && leg.b.pos.y > -1.4, `${f1(leg.b.pos.y)} m, deepest ${f1(leg.deepest)} m`);
  }
  /*
   * A big piece on ground that bends under it. One plane through the middle
   * of a 25 m wing put it 1-4 m into a hillside wherever the slope was not
   * the same all along (the crash sweep, finding 4): the plane was right at
   * the middle and wrong at both ends. Now each corner is on the ground
   * under it, so a wing lies across a hollow, bridging it.
   */
  {
    const hollow = (x) => -6 * Math.exp(-((x / 12) ** 2));
    const slopeAt = (x) => {
      const d = (hollow(x + 0.5) - hollow(x - 0.5)) / 1;
      const n = Math.hypot(d, 1);
      return { nx: -d / n, ny: 1 / n };
    };
    const env = { surface: (x, z, o) => { const n = slopeAt(x); return Object.assign(o, { y: hollow(x), nx: n.nx, ny: n.ny, nz: 0, kind: 'ground', floor: -40 }); } };
    for (const [label, size] of [['a wing', V(24, 0.8, 4)], ['a fuselage section', V(5, 5, 24)], ['a tailplane', V(9, 0.5, 2.5)]]) {
      const b = BB.makeBody({ position: V(0, 3, 0), size, mass: 3000, quaternion: new THREE.Quaternion().setFromEuler(new THREE.Euler(0, label === 'a fuselage section' ? Math.PI / 2 : 0, 0)) });
      for (let t = 0; t < 30 && !b.sleeping; t += 1 / 60) BB.stepBody(b, 1 / 60, env);
      let worst = 0;
      const p = new THREE.Vector3();
      for (let i = 0; i < 24; i += 3) {
        p.set(b.hull[i], b.hull[i + 1], b.hull[i + 2]).applyQuaternion(b.quat).add(b.pos);
        worst = Math.min(worst, p.y - hollow(p.x));
      }
      ok(`pieces: ${label} lying across a hollow is on the ground at both ends, not buried by one plane through its middle`, worst > -0.6, `lowest corner ${f1(worst)} m under the ground`);
    }
  }
  const shallow = (() => {
    const env = { surface: (x, z, o) => Object.assign(o, { y: 0, nx: 0, ny: 1, nz: 0, kind: 'water', floor: -2.5 }) };
    const b = BB.makeBody({ position: V(0, 3, 0), size: V(1.2, 1.2, 3), mass: 600, float: 1.3, floatT: 1 });
    for (let t = 0; t < 60 && !b.sleeping; t += 1 / 60) BB.stepBody(b, 1 / 60, env);
    return b;
  })();
  ok('pieces: in shallow water it settles on the sea bed, not through it', shallow.sunk && shallow.pos.y > -2.5 && shallow.pos.y < -1, `${f1(shallow.pos.y)} m over a -2.5 m bed`);
}

/* ---- 8. the airframe at sea ------------------------------------------------- */
for (const [name, L] of [['a trainer', 7.4], ['a regional jet', 22], ['a jumbo', 70]]) {
  const times = F.sinkTimes(L);
  const k = { L, ...times, top: L * 0.12, draft: 0.6, heavy: -1, phase: 0, floor: -60 };
  const at = (t) => F.sinkPose(k, t);
  const under = (() => {
    for (let t = 0; t < 120; t += 0.1) if (at(t).under) return t;
    return Infinity;
  })();
  ok(`at sea: ${name} floats first (afloat at ${f1(times.floatT * 0.8)} s), and goes under in 20-60 s`, at(times.floatT * 0.8).phase === 'afloat' && at(times.floatT * 0.8).y > -1.2 && under >= 20 && under <= 62, `under at ${f1(under)} s`);
  const s = at(times.floatT + times.settleT * 0.9);
  ok(`at sea: ${name} settles nose first (its engines are forward)`, s.phase === 'settling' && s.pitch > 0.15, `pitch ${f1(s.pitch * 57.3)}°`);
  const end = at(under + 1);
  ok(`at sea: ${name} ends with its highest point a couple of metres under`, end.y + end.highest < -1.5 && end.y + end.highest > -3.5, `top at ${f1(end.y + end.highest)} m`);
}
ok('at sea: an airliner floats noticeably longer than a trainer', F.sinkTimes(70).floatT > F.sinkTimes(7.4).floatT * 2.5);
/*
 * Slowly, with room to spare. The browser's sea check lets a hull go down no
 * faster than max(1.2, 0.025 x its length) m/s; the A380 (72.7 m long, about
 * 24 m from its belly to the top of the fin) once peaked at 1.78 of its 1.82
 * and failed the check now and then. It has to be well inside, all the way
 * down, and all of it inside the minute.
 */
for (const [name, L, top, draft] of [['an A380', 72.7, 24, 1.6], ['a 747', 70.7, 19.4, 1.5], ['an A320', 37.6, 11.8, 1.1], ['a trainer', 7.4, 1.6, 0.6]]) {
  const k = { L, ...F.sinkTimes(L), top, draft, heavy: -1, phase: 0, floor: -200 };
  let peak = 0;
  for (let t = 0.05; t < 90; t += 0.05) peak = Math.max(peak, (F.sinkPose(k, t - 0.05).y - F.sinkPose(k, t).y) / 0.05);
  const cap = Math.max(1.2, 0.025 * L);
  ok(`at sea: ${name} never goes down faster than 85% of what the sea check allows (and is down inside the minute)`, peak < 0.85 * cap && k.total <= 60, `${peak.toFixed(2)} m/s at most, cap ${cap.toFixed(2)}; ${f1(k.total)} s in all`);
}
{
  // Coming in: from where the crash left it to floating. A dive into the sea
  // leaves an airliner's middle ten metres up, its nose in; a ditching leaves
  // it sitting on the water, its belly just in. Either way it comes in — it
  // never hangs over the water creeping down at the slow speed (the v62
  // recheck: an A380 left 11 m up took fifteen seconds to reach the water,
  // level, with a gap under it). Up over the water its belly is in the water
  // inside 2.5 s from as high as 18 m; from anywhere it floats inside six; and
  // once it is in (inT: all but the last slow metres), the swell's bob in any
  // phase on top, it goes no faster than 85% of what the sea check allows.
  // Its attitude comes round from the crash's as it comes in.
  const rows = [];
  let bad = false;
  let n = 0;
  for (const [name, L, top, draft, belly] of [['A380', 72.7, 17.3, 2.56, 4.65], ['747', 70.7, 13.5, 2.02, 3.67], ['A320', 37.6, 11.8, 1.23, 2.24], ['trainer', 7.4, 1.6, 0.31, 0.6]]) {
    const cap = Math.max(1.2, 0.025 * L);
    for (const y0 of [0.4, 2, 3, belly, 6.5, 11, 18]) {
      for (let ph = 0; ph < 6.3; ph += 0.7) {
        const k = { L, ...F.sinkTimes(L), top, draft, heavy: -1, phase: ph, floor: -200 };
        const P = F.settleProfile(L, y0, draft, belly);
        const y = (t) => F.settleAlong(P, y0, F.sinkPose(k, t).y, t);
        let wetAt = Infinity;
        let inAt = Infinity;
        for (let t = 0; t < 30; t += 0.02) {
          if (wetAt === Infinity && y(t) <= belly + 0.02) wetAt = t;
          if (inAt === Infinity && Math.abs(y(t) - F.sinkPose(k, t).y) < 0.5) inAt = t;
        }
        let peak = 0;
        for (let t = P.inT + 0.05; t < 45; t += 0.05) peak = Math.max(peak, (y(t - 0.05) - y(t)) / 0.05);
        const up = y0 > belly + 0.05;
        const pass = Math.abs(y(0) - y0) < 1e-9 && (!up || (P.air > 0 && wetAt <= 2.5)) && inAt <= 6 && peak < 0.85 * cap && F.settleTurn(P, 0) === 0 && F.settleTurn(P, Math.max(2, P.inT)) === 1;
        n++;
        if (!pass) bad = true;
        if ((ph === 0 && (y0 === 3 || y0 === belly || y0 === 11)) || !pass) rows.push(`${name} from ${f1(y0)} m: ${up ? `belly in at ${f1(wetAt)} s, ` : ''}afloat at ${f1(inAt)} s, then ${peak.toFixed(2)}/${cap.toFixed(2)} m/s${pass ? '' : ' FAIL'}`);
      }
    }
  }
  ok('at sea: from where the crash left it, it comes in — falls in from up over the water (belly in inside 2.5 s), afloat inside 6 s, then never faster than 85% of the sea check (any swell)', !bad && n >= 200, rows.join('; '));
  // And a small way in (the last metre and a half, a trainer's splash) is what it always was.
  const P = F.settleProfile(7.4, 0.3, 0.31, 0.6);
  ok('at sea: a small way in settles exactly as before, at the slow speed', P.air === 0 && P.inT === 0 && Math.abs(P.T - F.settleInT(7.4, 0.61)) < 1e-9 && Math.abs(F.settleIn(0.3, -0.31, P.T / 2, 7.4, 0.31, 0.6) - (0.3 - 0.61 / 2)) < 1e-9 && F.settleInT(72.7) > F.settleInT(7.4), `${f1(P.T)} s`);
}
{
  // The life raft: in the water, even when the wreck is a few metres off a
  // beach (v62 recheck: an A320 ditched 8 m off the sand put its pilot's
  // raft 4 m up inside the hill — it was put abeam, either side, blind).
  // A straight shore along x = 10, the sea beyond it; the wreck 8 m out.
  const sea = (x) => x > 11.6;
  let onLand = 0;
  let n = 0;
  for (const L of [7.4, 22, 37.6, 72.7]) {
    for (const yaw of [0, 0.4, Math.PI / 2, 2.5, Math.PI, -1.2]) {
      for (let i = 0; i < 12; i++) {
        const s = F.raftSpot(18, 0, yaw, L, (x) => sea(x));
        n++;
        if (!s.wet || !sea(s.x) || Math.hypot(s.x - 18, s.z) < 4) onLand++;
      }
    }
  }
  ok('at sea: the pilot\'s raft goes in the water, never on the shore beside it', onLand === 0, `${onLand} of ${n} on the land`);
  const open = F.raftSpot(0, 0, 0, 37.6, () => true);
  ok('at sea: …and in open water it is where it always was: abeam, a little over half the length out', open.wet && Math.abs(Math.abs(open.x) - (37.6 * 0.45 + 5)) < 1e-9 && Math.abs(open.z) < 1e-9, `${f1(open.x)}, ${f1(open.z)}`);
}
ok('at sea: the slow sink eases in and out, and never runs at more than a third over its average', (() => {
  let worst = 0;
  for (let s = 0; s < 1; s += 0.001) worst = Math.max(worst, (F.sinkEase(s + 0.001) - F.sinkEase(s)) / 0.001);
  return F.sinkEase(0) === 0 && F.sinkEase(1) === 1 && worst < 1.34 && Math.abs(F.sinkEase(0.5) - 0.5) < 1e-9;
})());
{
  const k = { L: 20, ...F.sinkTimes(20), top: 3, draft: 0.8, heavy: -1, phase: 0, floor: -3 };
  const end = F.sinkPose(k, 200);
  ok('at sea: over a shallow bed it rests on the bottom, not under it', end.y > -3 + 0.5, `${f1(end.y)} m over a -3 m bed`);
  // An A380 on a bed five metres down: its top half is still out, so it is
  // aground — a wreck that stays — never "under" and tidied away in plain sight.
  const big = { L: 73, ...F.sinkTimes(73), top: 20, draft: 2.4, heavy: -1, phase: 0, floor: -5 };
  const bigEnd = F.sinkPose(big, 200);
  ok('at sea: an airliner too tall for the water it is in ends aground, its top out, not under', bigEnd.phase === 'aground' && !bigEnd.under && bigEnd.y + bigEnd.highest > 0, `${bigEnd.phase}, top at ${f1(bigEnd.y + bigEnd.highest)} m`);
  // All the way down, its low end never goes into the bed (it lies on it, tilted only as far as the water lets it).
  let worst = Infinity;
  for (const kk of [big, { L: 7.4, ...F.sinkTimes(7.4), top: 1.6, bot: -1.1, draft: 0.6, heavy: -1, phase: 1, floor: -2.5 }]) {
    const belly = Number.isFinite(kk.bot) ? -kk.bot : kk.draft * 1.8;
    for (let t = 0; t < 120; t += 0.25) {
      const P = F.sinkPose(kk, t);
      worst = Math.min(worst, P.y - belly * Math.cos(P.pitch) - (kk.L / 2) * Math.sin(Math.abs(P.pitch)) - kk.floor);
    }
  }
  ok('at sea: in shallow water its low end never goes into the sea bed', worst > -0.05, `${f1(worst)} m above the bed at the lowest`);
  const deep = F.sinkPose({ ...big, floor: -80 }, 200);
  ok('at sea: …and in deep water the same airliner goes right under', deep.phase === 'under' && deep.under && deep.y + deep.highest < -1.5, `${deep.phase}, top at ${f1(deep.y + deep.highest)} m`);
}

/* ---- 9. seizure safety: the crash cam and the replay stand back ---------------- */
{
  // The v62 check: pieces tumbling across a close camera took the A320's
  // nose-first crash over WCAG's 25% (tests/features/breakup.browser.js
  // measures the scenes; this holds the wiring).
  const CR = await imp('features/crashes.js');
  ok('seizure safety: with Reduce flashing the crash cam stands back (at least 1.4x), and the instant replay further (at least 1.9x)', CR.CRASH_CAM_BACK_REDUCED >= 1.4 && F.REPLAY.backReduced >= 1.9,
    `crash cam ${CR.CRASH_CAM_BACK_REDUCED}x, replay ${F.REPLAY.backReduced}x`);
  // The crash sweep (finding 1): at 1.5x the fighters', the racer's and the small tourers' cartoon crashes were
  // over WCAG's line; every size now stands back by the same two, from 16 m up to 110 m before it.
  const sizes = { man: { L: 3, semi: 1.75 }, trainer: { L: 7.4, semi: 5.5 }, fighter: { L: 19, semi: 6.5 }, a320: { L: 37, semi: 17.9 }, a380: { L: 75, semi: 39 } };
  const rows = Object.entries(sizes).map(([k, d]) => [k, CR.crashCamDistance(d, false), CR.crashCamDistance(d, true)]);
  ok('seizure safety: the crash cam stands twice as far back with Reduce flashing, for every size, and never nearer than 48 m or further than 220', rows.every(([, a, b]) => Math.abs(b / a - CR.CRASH_CAM_BACK_REDUCED) < 1e-9 && b >= 48 && b <= 220),
    rows.map(([k, a, b]) => `${k} ${f1(a)} -> ${f1(b)} m`).join(', '));
}

/* ---- 10. seizure safety: the secondary pops go through Reduce flashing ---------- */
{
  const FS = await imp('render/flash-safety.js');
  const FX = await imp('features/breakup/fx.js');
  const was = FS.FLASH.reduce;
  // Eight pops in one second, the worst a big break-up can schedule.
  const burst = () => {
    const fx = new FX.BreakupFx(new THREE.Group(), 'high');
    const at = (o) => (o.set(0, 1, 0), true);
    for (let i = 0; i < 8; i++) fx.later(0.05 + i * 0.125, at, 1.5);
    let maxPopColour = 0;
    for (let t = 0; t < 1.2; t += 1 / 60) {
      fx.update(1 / 60, null);
      for (const p of fx.pools[0].p) if (p.alive && p.kind === 'pop') maxPopColour = Math.max(maxPopColour, p.r);
    }
    return { stats: fx.stats, maxPopColour };
  };
  FS.FLASH.reduce = true;
  const on = burst();
  FS.FLASH.reduce = false;
  const off = burst();
  FS.FLASH.reduce = was;
  ok('flashing: with Reduce flashing on, eight pops in a second flare at most three times', on.stats.pops === 8 && on.stats.popFlares <= FS.MAX_FLASHES_PER_SECOND, `${on.stats.popFlares} flares of ${on.stats.pops} pops`);
  ok('flashing: …and no flare is brighter than an explosion\'s flash sprite is let be', on.maxPopColour <= FS.CAPS.blastSprite + 1e-6 && on.stats.popBright <= FS.CAPS.blastSprite + 1e-6, `${f1(on.maxPopColour * 100)}% of full`);
  ok('flashing: …every pop still burns and smokes (only the flare is held back)', on.stats.smoke >= 8 * 6 && on.stats.pop > 8 * 10, `${on.stats.smoke} smoke, ${on.stats.pop} flame`);
  ok('flashing: switched off, every pop is the full flare it always was', off.stats.popFlares === 8 && off.maxPopColour === 1, `${off.stats.popFlares} flares, ${f1(off.maxPopColour * 100)}%`);

  // A piece turning over: a big one slowly, a small one fast; under one turn a second with the switch on.
  const fuselage = V(4.5, 4.3, 18.8);
  const tip = V(2, 0.3, 1.2);
  const offBig = F.spinCap(fuselage, false);
  const offSmall = F.spinCap(tip, false);
  ok('flashing: a big piece turns over slower than a small one (its ends at a real speed)', offBig < offSmall && offBig * 0.5 * fuselage.length() <= F.SPIN.TIP_SPEED + 1e-6 && offSmall <= 30, `fuselage section ${f1(offBig)} rad/s, tip ${f1(offSmall)} rad/s`);
  ok('flashing: with Reduce flashing on nothing turns over faster than one turn a second', F.spinCap(tip, true) <= F.SPIN.REDUCED && F.SPIN.REDUCED < 2 * Math.PI && F.spinCap(fuselage, true) <= offBig, `tip ${f1(F.spinCap(tip, true))} rad/s`);
  const spun = BB.makeBody({ position: V(0, 50, 0), size: tip, mass: 30, omega: V(0, 40, 0), maxSpin: F.spinCap(tip, true) });
  let fastest = 0;
  for (let t = 0; t < 1; t += 1 / 60) {
    BB.stepBody(spun, 1 / 60, { surface: (x, z, o) => Object.assign(o, { y: 0, nx: 0, ny: 1, nz: 0, kind: 'ground' }) });
    fastest = Math.max(fastest, spun.omega.length());
  }
  ok('flashing: …and a piece flung spinning is held to it from the first step', fastest <= F.SPIN.REDUCED + 1e-6, `${f1(fastest)} rad/s at most`);
}

/* ---- the key ------------------------------------------------------------------ */
{
  const a = I.ACTIONS.crashReplay;
  ok('key: the instant replay is one key in the registry, under View, for the aeroplane and the helicopter', !!a && a.group === 'View' && a.ctx.includes('plane') && a.ctx.includes('heli') && a.default.length === 1, a ? `${a.default.join(',')} ${a.group} [${a.ctx}]` : 'missing');
  const all = I.findConflicts(I.defaultBindings());
  const clash = Object.entries(all).filter(([id, list]) => id === 'crashReplay' || JSON.stringify(list).includes('crashReplay'));
  ok('key: and it clashes with nothing', !clash.length, JSON.stringify(clash));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

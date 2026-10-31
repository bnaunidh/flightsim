/**
 * Node checks for the cockpits (src/aircraft/cockpit.js + cockpit/).
 *
 *   node tests/features/cockpits.mjs
 *
 * No browser: canvas is stubbed as civil.mjs does. What it holds:
 *
 *   1. Every type on the roster belongs to a family, and gets the builder its
 *      family has — light types the light cockpit, every other family the
 *      generic one (until their builders land), T-Pose Harrison 'none'.
 *   2. The light cockpits MATCH THEIR EXTERIOR FROM THE SEAT. Built on the
 *      real model and placed exactly as main.js places it, rays from the
 *      pilot's eye (both cockpit views) are cast at the exterior hull:
 *        - at its window glass: most of each window must be seen, nothing of
 *          the cockpit in the way but the furniture a real one has there;
 *        - at its painted skin: almost every ray must meet the cockpit
 *          before it gets there — no sky through a wall that is metal
 *          outside.
 *   3. The glareshield sits on the windscreen's sill, not above it (it would
 *      hide windscreen) and not far below it (a dark slot under the glass).
 *   4. Cheap: after it is built, a second of flight repaints no texture but
 *      the altimeter drum, at most ten times; and an update costs well under
 *      a millisecond here.
 *   5. The behaviours: warning lamps + master caution, autopilot lamp,
 *      blackout (flags out, lamps dark, needles frozen), rain on the glass
 *      only when wet, controls move, no NaN.
 *   6. Fallbacks: a light type on a model with no hull (the fleet pack's, or
 *      none at all) still gets a light cockpit; a builder that throws gets
 *      the generic one.
 */
global.document = {
  createElement: () => ({
    getContext: () =>
      new Proxy(
        {
          measureText: (t) => ({ width: String(t).length * 6 }),
          // As the browser's: a negative corner radius throws (the C-17's
          // panel once came out with a negative height, and its deck fell
          // back to the generic cockpit in the game while this stub said ok).
          roundRect: (x, y, w, h, r) => {
            if (!(r >= 0)) throw new RangeError(`Radius value ${r} is negative.`);
          },
        },
        { get: (o, k) => (k in o ? o[k] : () => ({ addColorStop() {}, data: new Uint8ClampedArray(4) })), set: () => true }
      ),
    width: 0,
    height: 0,
    style: {},
  }),
  body: { appendChild() {} },
};

import { readFileSync } from 'node:fs';
const SRC = new URL('../../src/', import.meta.url).href;
const THREE = await import(SRC + 'vendor/three.module.js');
const { AIRCRAFT, getAircraft } = await import(SRC + 'aircraft/types.js');
const adapter = await import(SRC + 'aircraft/model-adapter.js');
const { schemeFor } = await import(SRC + 'aircraft/liveries.js');
const CP = await import(SRC + 'aircraft/cockpit.js');
const { TRAINER_EYE } = await import(SRC + 'aircraft/cockpit/common.js');

const results = [];
const ok = (name, pass, detail = '') => {
  results.push({ name, pass: !!pass, detail: String(detail) });
  return !!pass;
};

const LIGHT = ['skylark', 'courier', 'tempest'];
const REALISTIC_OFFSET = new THREE.Vector3(0, -0.02, 0.16); // flight/camera.js
const lerp = (a, b, t) => a + (b - a) * t;

/** Build the model and the cockpit, and seat the cockpit as main.js does. */
function seated(id, { model: given } = {}) {
  const type = getAircraft(id);
  const S = type.shape;
  const model = given === undefined ? adapter.createAircraftModel({ type, livery: schemeFor(type, 'house') }) : given;
  const cockpit = CP.createCockpit({ type, model });
  const host = model || new THREE.Group();
  const k = host.userData.fleetBridge ? 1 : S.scale;
  const eye = adapter.eyeFor(host, [S.eye[0] * S.scale, S.eye[1] * S.scale, S.eye[2] * S.scale]);
  cockpit.scale.setScalar(1 / k);
  cockpit.position.set((eye[0] - TRAINER_EYE[0]) / k, (eye[1] - TRAINER_EYE[1]) / k, (eye[2] - TRAINER_EYE[2]) / k);
  if (!model) host.scale.setScalar(k);
  host.add(cockpit);
  host.updateMatrixWorld(true);
  return { type, model: host, cockpit, eye: new THREE.Vector3(...eye), k };
}

/**
 * The panel's needles are one mesh per material (gauges.js _batch): every
 * needle's vertices must be where its pivot now points. Returns
 * { needles, worst } — the number of needles and the worst miss in metres.
 */
function needlesFollow(cockpit) {
  const panel = cockpit.userData.panel;
  let needles = 0;
  let worst = 0;
  const v = new THREE.Vector3();
  for (const b of (panel && panel.batches) || []) {
    const P = b.mesh.geometry.attributes.position;
    b.items.forEach((it, i) => {
      needles++;
      it.piv.updateMatrix();
      for (let k = 0; k < b.owner.length; k++) {
        if (b.owner[k] !== i) continue;
        v.set(b.local[k * 3], b.local[k * 3 + 1], b.local[k * 3 + 2]).applyMatrix4(it.piv.matrix);
        worst = Math.max(worst, Math.hypot(v.x - P.getX(k), v.y - P.getY(k), v.z - P.getZ(k)));
      }
    });
  }
  return { needles, worst };
}

/**
 * kit.js batchMovers: every moving part's pieces are in a skinned mesh, its
 * part the bone. Each piece's first vertex, skinned, must be where the
 * original piece (still in the tree, on a layer nobody draws) now is.
 */
function moversFollow(cockpit) {
  cockpit.updateMatrixWorld(true);
  let parts = 0;
  let batches = 0;
  let worst = 0;
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  cockpit.traverse((o) => {
    if (!o.isSkinnedMesh || !o.userData.parts) return;
    batches++;
    o.skeleton.update();
    const P = o.geometry.attributes.position;
    for (const part of o.userData.parts) {
      parts++;
      const g = part.mesh.geometry;
      const i0 = g.index ? g.index.getX(0) : 0;
      a.fromBufferAttribute(g.attributes.position, i0).applyMatrix4(part.mesh.matrixWorld);
      b.fromBufferAttribute(P, part.start);
      o.applyBoneTransform(part.start, b).applyMatrix4(o.matrixWorld);
      worst = Math.max(worst, a.distanceTo(b));
    }
  });
  return { parts, batches, worst };
}

function fakeAc(over = {}) {
  const fwd = new THREE.Vector3(0, 0, -1);
  return {
    ias: 50,
    airspeed: 50,
    alt: 600,
    vs: 1,
    heading: 90,
    slipBall: 0.1,
    turnRate: 1,
    rpm: 0.8,
    engineOn: true,
    flaps: 0,
    trim: 0.1,
    gearDown: true,
    gearPos: 1,
    fuel: 100,
    fuelFraction: () => 0.6,
    pos: { y: 600 },
    failures: {},
    controls: { roll: 0, pitch: 0, yaw: 0, throttle: 0.7, brakes: 0 },
    forward: (out) => out.copy(fwd),
    bankAngleDeg: () => 10,
    ...over,
  };
}
const WEATHER = (rain = 0, time = 'day') => ({ time, cond: { rain, cloud: 0.2 } });

function nanCount(root) {
  let bad = 0;
  // Fresh matrices: a part turned to NaN by its update keeps its last good
  // matrixWorld until the next render (the Tempest's levers hid that way).
  root.updateMatrixWorld(true);
  root.traverse((o) => {
    const g = o.geometry;
    if (g) for (const n of ['position', 'normal', 'uv']) {
      const a = g.attributes[n];
      if (a) for (let i = 0; i < a.array.length; i++) if (!Number.isFinite(a.array[i])) bad++;
    }
    for (const e of o.matrixWorld.elements) if (!Number.isFinite(e)) bad++;
  });
  return bad;
}

/** Every mesh of a root, shown or not (a dark lamp is not drawn). */
function allMeshes(root) {
  const out = [];
  root.traverse((o) => o.isMesh && out.push(o));
  return out;
}

/** Visible meshes of a root, for raycasting. */
function meshesOf(root) {
  const out = [];
  root.traverse((o) => {
    if (!o.isMesh) return;
    for (let p = o; p; p = p.parent) if (!p.visible) return;
    out.push(o);
  });
  return out;
}

/**
 * Centroids of the triangles of one geometry group of a mesh, world space.
 * `facingAwayFrom`: keep only triangles whose outside faces away from that
 * point — the ones a ray from it would meet from INSIDE the skin, where they
 * are culled and draw nothing. (A triangle that faces the eye is outside
 * skin seen through a window — the cowl through the windscreen — and is
 * meant to be seen.)
 */
function groupCentroids(mesh, groupIndex, filter = () => true, facingAwayFrom = null) {
  const g = mesh.geometry;
  const p = g.attributes.position;
  const idx = g.index.array;
  const grp = g.groups[groupIndex];
  const out = [];
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const n = new THREE.Vector3();
  const e = new THREE.Vector3();
  for (let i = grp.start; i < grp.start + grp.count; i += 3) {
    a.fromBufferAttribute(p, idx[i]).applyMatrix4(mesh.matrixWorld);
    b.fromBufferAttribute(p, idx[i + 1]).applyMatrix4(mesh.matrixWorld);
    c.fromBufferAttribute(p, idx[i + 2]).applyMatrix4(mesh.matrixWorld);
    const m = a.clone().add(b).add(c).multiplyScalar(1 / 3);
    if (!filter(mesh.worldToLocal(m.clone()))) continue;
    if (facingAwayFrom) {
      n.subVectors(b, a).cross(e.subVectors(c, a));
      if (n.dot(e.subVectors(m, facingAwayFrom)) <= 0) continue;
    }
    out.push(m);
  }
  return out;
}

const ray = new THREE.Raycaster();
/** Fraction of `targets` the eye can see with nothing of `blockers` in front. */
function clearFraction(eye, targets, blockers, margin = 0.02, collect = null) {
  let clear = 0;
  for (const t of targets) {
    const d = t.clone().sub(eye);
    const dist = d.length();
    ray.set(eye, d.normalize());
    ray.near = 0.01;
    ray.far = dist - margin;
    if (!ray.intersectObjects(blockers, false).length) {
      clear++;
      if (collect) collect.push(t);
    }
  }
  return targets.length ? clear / targets.length : 1;
}
const DEBUG = !!process.env.COCKPIT_DEBUG;

/* ------------------------------------------------------------------ *
 * 1. Families
 * ------------------------------------------------------------------ */
for (const t of AIRCRAFT) {
  ok(`${t.id}: listed in the cockpit family table`, !!CP.FAMILY[t.id], CP.cockpitFamily(t));
}

/* ------------------------------------------------------------------ *
 * The Low budget: every cockpit, built on the model the game draws, is a
 * handful of draws (the room merged per material, the moving parts one
 * skinned draw per material), well under 40k triangles, and at most ten
 * screens whose canvases the bus repaints two a frame at ~10 Hz.
 * ------------------------------------------------------------------ */
{
  const cam = new THREE.Layers();
  cam.set(0);
  for (const t of AIRCRAFT) {
    if (t.id === 'tpose') continue;
    let s;
    try {
      s = seated(t.id);
    } catch (e) {
      ok(`${t.id}: builds on its own model`, false, e && e.message);
      continue;
    }
    const { cockpit } = s;
    let draws = 0;
    let tris = 0;
    cockpit.traverse((o) => {
      if (!o.isMesh || !o.visible || !o.layers.test(cam)) return;
      for (let p = o.parent; p && p !== cockpit; p = p.parent) if (!p.visible) return;
      const g = o.geometry;
      draws++;
      tris += (g.index ? g.index.count : g.attributes.position.count) / 3;
    });
    const screens = (cockpit.userData.displays || []).length;
    const perFrame = cockpit.userData.bus ? cockpit.userData.bus.maxPerFrame : 0;
    ok(`${t.id}: in the Low budget — ${draws} draws, ${Math.round(tris)} triangles, ${screens} screens`, draws <= 60 && tris <= 40000 && screens <= 10 && (!perFrame || perFrame <= 2), `bus ${perFrame}/frame`);
  }
}
for (const fam of ['light', 'jet', 'racer', 'airliner', 'heli']) {
  ok(`the ${fam} family has a builder`, CP.registeredFamilies().includes(fam), CP.registeredFamilies().join(', '));
}
// Every aeroplane on the roster gets its own family's cockpit — none is left
// on the generic box (T-Pose Harrison has no cockpit: his view is his head).
for (const t of AIRCRAFT) {
  const fam = CP.cockpitFamily(t);
  if (fam === 'none') continue;
  const b = CP.builderFor(t);
  ok(`${t.id}: has a ${fam} cockpit builder`, b && b.family === fam, b ? b.family : 'none');
  let built = null;
  try {
    built = seated(t.id).cockpit;
  } catch (e) {
    built = null;
  }
  const want = fam === 'racer' ? 'jet:' : `${fam}:`;
  ok(`${t.id}: is built by it, not the generic fallback`, built && String(built.userData.builder).startsWith(want), built && built.userData.builder);
}
ok("T-Pose Harrison's family is 'none' (his own view is another builder's)", CP.cockpitFamily(getAircraft('tpose')) === 'none');

/* ------------------------------------------------------------------ *
 * 2-5. The light cockpits
 * ------------------------------------------------------------------ */
for (const id of LIGHT) {
  let s;
  try {
    s = seated(id);
  } catch (e) {
    ok(`${id}: builds`, false, e && e.stack);
    continue;
  }
  const { model, cockpit, eye } = s;
  ok(`${id}: built by the light builder from the exterior hull`, cockpit.userData.builder === `light:${id}` && cockpit.userData.glazing.source === 'hull', `${cockpit.userData.builder} / ${cockpit.userData.glazing && cockpit.userData.glazing.source}`);
  ok(`${id}: no NaN anywhere`, nanCount(cockpit) === 0);
  ok(`${id}: exposes panel.texture, panelFace and the warning lamps`, !!cockpit.userData.panel.texture && !!cockpit.userData.panelFace && cockpit.userData.warnings.length === 8);

  /* ---- 2. From the seat, the windows are the exterior's windows ---- */
  const fuselage = model.children.find((o) => o.name === 'fuselage');
  const shell = cockpit.userData.shell;
  const blockers = meshesOf(cockpit).filter((m) => !/glass|rain/i.test(m.name) && !(m.material && m.material.transparent));
  // Windows behind the pilot are behind the seats, as they are in any
  // aeroplane; whether the ROOM has a hole where the window is, is asked
  // with the seats out of the way.
  const room = blockers.filter((m) => !/seat/.test(m.name) && !/seat/.test(m.parent && m.parent.name));
  const zA = shell.rings[0];
  const zB = shell.rings[shell.rings.length - 1];
  for (const [view, eyePt] of [['cockpit view', eye], ['realistic cockpit', eye.clone().add(REALISTIC_OFFSET)]]) {
    // Each window separately: its glass triangles inside the cabin.
    const ws = shell.openings;
    ws.forEach((w, i) => {
      const glass = groupCentroids(fuselage, 1, (m) => m.z > w.z0 + 1e-3 && m.z < w.z1 - 1e-3);
      if (!glass.length) return;
      // The windscreen is partly behind the glareshield's lip, the compass
      // and the visors; side windows partly behind door posts when seen this
      // obliquely. Most of each must be open.
      const behind = (w.z0 + w.z1) / 2 * s.k > eyePt.z;
      const f = clearFraction(eyePt, glass, behind ? room : blockers);
      const need = i === 0 ? 0.75 : 0.6;
      ok(`${id} (${view}): window ${i + 1} (z ${w.z0.toFixed(2)}..${w.z1.toFixed(2)}${behind ? ', behind the seat' : ''}) is open from the seat`, f >= need, `${(f * 100).toFixed(0)}% of ${glass.length} glass points clear`);
    });
    // The painted skin round the cabin must be covered from inside.
    const skin = groupCentroids(fuselage, 0, (m) => m.z > zA + 0.02 && m.z < zB - 0.02, eyePt);
    const seen = [];
    const leak = 1 - clearFraction(eyePt, skin, blockers, 0.002, seen);
    if (DEBUG && seen.length) console.log(id, view, 'skin seen through:', seen.map((p) => model.worldToLocal(p.clone()).toArray().map((v) => v.toFixed(2)).join(',')).join('  '));
    ok(`${id} (${view}): no daylight through the walls — every metal panel outside is a wall inside`, leak >= 0.995, `${((1 - leak) * 100).toFixed(1)}% of ${skin.length} skin points seen straight through`);
  }

  /* ---- 3. Glareshield on the sill ---- */
  {
    const glare = cockpit.getObjectByName('glareshield');
    const box = new THREE.Box3().setFromObject(glare);
    const ws = shell.openings[0];
    const sill = shell.sill(ws, 8).map((p) => p.clone().applyMatrix4(cockpit.getObjectByName('interior skin').matrixWorld));
    const sillTop = Math.max(...sill.map((p) => p.y));
    ok(`${id}: the glareshield's top is on the windscreen's sill (within 3 cm under it)`, box.max.y <= sillTop + 0.005 && box.max.y >= sillTop - 0.03, `glareshield ${box.max.y.toFixed(3)}, sill ${sillTop.toFixed(3)}`);
  }

  /* ---- 4. Cheap ---- */
  {
    const textures = new Set();
    cockpit.traverse((o) => {
      if (!o.isMesh) return;
      for (const k of ['map', 'emissiveMap']) if (o.material[k]) textures.add(o.material[k]);
    });
    const before = new Map([...textures].map((t) => [t, t.version]));
    const ac = fakeAc();
    for (let i = 0; i < 60; i++) {
      ac.alt += 3; // climbing: the drum has something to show
      ac.heading = (ac.heading + 1) % 360;
      cockpit.userData.update(1 / 60, ac, WEATHER(0), null);
    }
    let uploads = 0;
    for (const [t, v] of before) uploads += t.version - v;
    ok(`${id}: a second of flight re-uploads at most 10 textures (the altimeter drum), not the panel`, uploads <= 10 && cockpit.userData.panel.texture.version === before.get(cockpit.userData.panel.texture), `${uploads} uploads`);
    // CPU time, not wall time: a CPU governor may pause this process.
    const w = WEATHER(0.5);
    const c0 = process.cpuUsage();
    for (let i = 0; i < 600; i++) {
      ac.controls.roll = Math.sin(i / 30) * 0.5;
      cockpit.userData.update(1 / 60, ac, w, null);
    }
    const c1 = process.cpuUsage(c0);
    const ms = (c1.user + c1.system) / 1000 / 600;
    ok(`${id}: an update costs under 0.1 ms of CPU here`, ms < 0.1, `${ms.toFixed(4)} ms`);
  }

  /* ---- 5. Behaviours ---- */
  {
    const ac = fakeAc({ failures: { engine: true } });
    const sim = { instrumentBlackout: 0, autopilot: { engaged: true } };
    for (let i = 0; i < 10; i++) cockpit.userData.update(1 / 60, ac, WEATHER(0), sim);
    const lamps = cockpit.userData.warnings;
    const eng = lamps.find((l) => l.key === 'engine');
    ok(`${id}: the ENGINE lamp lights for an engine failure`, eng.mat.emissiveIntensity > 1);
    let flashed = false;
    const master = cockpit.getObjectByName('master caution');
    for (let i = 0; i < 60; i++) {
      cockpit.userData.update(1 / 60, ac, WEATHER(0), sim);
      if (master.material.emissiveIntensity > 1) flashed = true;
    }
    ok(`${id}: and the master caution flashes`, flashed);
    const ap = allMeshes(cockpit).find((m) => m.name === 'lamp AP');
    ok(`${id}: the AP lamp is lit while the autopilot flies`, ap && ap.material.emissiveIntensity > 1);
    sim.autopilot.engaged = false;
    cockpit.userData.update(1 / 60, ac, WEATHER(0), sim);
    ok(`${id}: ...and dark when it does not`, ap && ap.material.emissiveIntensity === 0);

    // Blackout: flags out, lamps dark, needles frozen.
    const panel = cockpit.userData.panel;
    sim.instrumentBlackout = 5;
    cockpit.userData.update(1 / 60, ac, WEATHER(0), sim);
    const card = cockpit.getObjectByName('heading card');
    const frozen = card.rotation.z;
    ac.heading = (ac.heading + 90) % 360;
    for (let i = 0; i < 30; i++) cockpit.userData.update(1 / 60, ac, WEATHER(0), sim);
    ok(`${id}: in a blackout the gyros freeze, OFF flags show and the lamps go dark`,
      card.rotation.z === frozen && panel.flags.every((f) => f.visible) && eng.mat.emissiveIntensity === 0 && panel.faceMat.emissiveIntensity === 0);
    sim.instrumentBlackout = 0;
    for (let i = 0; i < 60; i++) cockpit.userData.update(1 / 60, ac, WEATHER(0), sim);
    ok(`${id}: ...and come back when the power does`, card.rotation.z !== frozen && panel.flags.every((f) => !f.visible));
    {
      const f = needlesFollow(cockpit);
      const mf = moversFollow(cockpit);
      ok(`${id}: the yokes, levers and pedals drawn as one are drawn where the pilot has moved them`, mf.parts > 0 && mf.worst < 1e-5, `${mf.parts} parts in ${mf.batches} draw(s), worst ${mf.worst.toExponential(1)} m`);
      ok(`${id}: every needle is drawn where its gauge points it (one needle mesh for the panel)`, f.needles >= 10 && f.worst < 1e-5 && panel.batches.length <= 2, `${f.needles} needles in ${panel.batches.length} mesh(es), worst ${f.worst.toExponential(1)} m`);
    }

    // Rain.
    const glass = shell.meshes.glass;
    cockpit.userData.update(1 / 60, ac, WEATHER(0.6), sim);
    const wet = glass.visible && glass.material.opacity > 0.2;
    cockpit.userData.update(1 / 60, ac, WEATHER(0), sim);
    ok(`${id}: rain runs down the inside of the real windows only when it is raining`, wet && !glass.visible);

    // Controls.
    const wheel = cockpit.getObjectByName('control wheel');
    ac.controls.roll = 1;
    for (let i = 0; i < 60; i++) cockpit.userData.update(1 / 60, ac, WEATHER(0), sim);
    ok(`${id}: the control wheels turn with the roll input`, wheel.rotation.z < -0.5, wheel.rotation.z.toFixed(2));
    ok(`${id}: no NaN after flying`, nanCount(cockpit) === 0);
  }
}

/* ------------------------------------------------------------------ *
 * 7. The jets, the airliners and the helicopter (cockpits v2)
 *
 *   - built by their own family, contract kept, no NaN
 *   - every screen paints the sim's own numbers (speed, height, heading,
 *     the autopilot's selections, the engines) — read back off what each
 *     painter says it drew — about 12 times a second, never per frame, and
 *     no canvas is made while flying
 *   - the camera never clips the cockpit: nothing within 10 cm of the eye in
 *     either view, in any direction the head can turn (near plane 0.08 m)
 *   - the view out is the exterior's: jets see out of the canopy above the
 *     sill and nothing but cockpit below it; airliners see out of every
 *     pane and nothing through the walls; the helicopter sees its chin
 *     bubbles
 *   - the HUD's horizon is on the horizon: its scale is worked out from the
 *     glass's distance from the eye, in both views
 *   - the exterior's own tinted canopy is hidden from a camera inside it,
 *     and only from one inside it
 *   - lamps, master caution, autopilot, blackout, and the controls move
 * ------------------------------------------------------------------ */
const { UNITS } = await import(SRC + 'aircraft/physics.js');
const JETS = ['vanguard', 'osprey', 'f22', 'f35b', 'fa18', 'massimo', 'nightjar', 'a10'];
/** Published fuselage widths (m) of the real aeroplanes the decks are cut for (an upper-deck cockpit still against the whole fuselage). */
const REAL_WIDTH = {
  meridian: 2.7, a320: 3.95, a321: 3.95, b737: 3.76, b787: 5.77, a350: 5.96, b777: 6.2, b747: 6.5, a380: 7.14,
  q400: 2.69, concorde: 2.88, belugaxl: 5.64, dreamlifter: 6.5, an225: 6.4, c5: 7.0, c17: 6.86, b1b: 2.2,
};
/** What the photographs show on each deck (cockpit-refs.md): the hands-on controls. */
const DECK_CHARACTER = {
  meridian: { stick: 'yoke', engines: 2 }, a320: { stick: 'side', engines: 2 }, a321: { stick: 'side', engines: 2 }, b737: { stick: 'yoke', engines: 2 },
  b787: { stick: 'yoke', engines: 2, hud: true }, a350: { stick: 'side', engines: 2 }, b777: { stick: 'yoke', engines: 2 }, b747: { stick: 'yoke', engines: 4 }, a380: { stick: 'side', engines: 4 },
  q400: { stick: 'yoke', engines: 2, levers: 'turboprop' }, concorde: { stick: 'yoke', engines: 4 }, belugaxl: { stick: 'side', engines: 2 }, dreamlifter: { stick: 'yoke', engines: 4 },
  an225: { stick: 'yoke', engines: 6 }, c5: { stick: 'yoke', engines: 4 }, c17: { stick: 'centre', engines: 4, hud: true }, b1b: { stick: 'centre', engines: 4 },
};
const AIRLINERS = ['meridian', 'a320', 'b747', 'a380', 'b737', 'a321', 'b787', 'a350', 'b777', 'q400', 'concorde', 'belugaxl', 'dreamlifter', 'an225', 'c5', 'c17', 'b1b'];
const HELIS = ['harrier', 'bell407', 'h145', 'r44', 'aw139', 'uh60', 'ch47', 'ah64'];

/** Closest distance from p to any triangle of the visible meshes. */
function nearest(p, meshes) {
  const tri = new THREE.Triangle();
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const q = new THREE.Vector3();
  let best = Infinity;
  let what = '';
  for (const m of meshes) {
    const g = m.geometry;
    const pos = g.attributes.position;
    const idx = g.index ? g.index.array : null;
    const n = idx ? idx.length : pos.count;
    // Cheap reject on the bounding sphere.
    if (!g.boundingSphere) g.computeBoundingSphere();
    const sph = g.boundingSphere.clone().applyMatrix4(m.matrixWorld);
    if (sph.distanceToPoint(p) > best) continue;
    for (let i = 0; i < n; i += 3) {
      a.fromBufferAttribute(pos, idx ? idx[i] : i).applyMatrix4(m.matrixWorld);
      b.fromBufferAttribute(pos, idx ? idx[i + 1] : i + 1).applyMatrix4(m.matrixWorld);
      c.fromBufferAttribute(pos, idx ? idx[i + 2] : i + 2).applyMatrix4(m.matrixWorld);
      tri.set(a, b, c);
      tri.closestPointToPoint(p, q);
      const d = q.distanceTo(p);
      if (d < best) {
        best = d;
        what = m.name || (m.parent && m.parent.name) || m.material.type;
      }
    }
  }
  return { d: best, what };
}

/** A sim stand-in with an autopilot whose selections differ from the aeroplane's state. */
function fakeSim(over = {}) {
  return {
    instrumentBlackout: 0,
    autopilot: { engaged: true, mode: 'hold', selectedHeadingDeg: 250, selectedAltFt: 5000, targetSpeedKts: 210, selectedVsFpm: 1200 },
    settings: { realisticCockpit: false },
    weather: { time: 'day' },
    ...over,
  };
}

const opaqueOf = (root) => meshesOf(root).filter((m) => !(m.material && m.material.transparent) && !/glass|rain/i.test(m.name || ''));

/** Points on a civil-kit hull at (z, s) set in by `inset` (hull units), in world space. */
function hullPoints(model, h, list, inset) {
  const P = new THREE.Vector3();
  const N = new THREE.Vector3();
  model.updateMatrixWorld(true);
  return list.map(([z, s]) => {
    h.point(z, s, P);
    h.normal(z, s, N);
    return P.clone().addScaledVector(N, -inset).applyMatrix4(model.matrixWorld);
  });
}

const ONLY = process.env.COCKPIT_ONLY ? process.env.COCKPIT_ONLY.split(',') : null;
for (const id of [...JETS, ...AIRLINERS, ...HELIS].filter((i) => !ONLY || ONLY.includes(i))) {
  let s;
  try {
    s = seated(id);
  } catch (e) {
    ok(`${id}: builds`, false, e && e.stack);
    continue;
  }
  const { model, cockpit, eye, k } = s;
  const fam = CP.cockpitFamily(getAircraft(id));
  const ud = cockpit.userData;
  ok(`${id}: built by the ${fam} builder`, String(ud.builder).startsWith(fam === 'racer' ? 'jet:' : `${fam}:`), ud.builder);
  ok(`${id}: no NaN anywhere`, nanCount(cockpit) === 0);
  ok(`${id}: exposes panel.texture, panelFace and the warning lamps`, !!ud.panel.texture && !!ud.panelFace && ud.warnings.length === 8);

  /* ---- The screens read the sim ---- */
  const KTS = UNITS.KTS;
  const FT = UNITS.FT;
  const ac = fakeAc({ ias: 120, airspeed: 125, alt: 900, heading: 123, vs: 3, groundSpeed: 118, gLoad: 1.4, quat: new THREE.Quaternion(), vel: new THREE.Vector3(0, 3, -125) });
  const sim = fakeSim();
  const created = [];
  const realCreate = global.document.createElement;
  global.document.createElement = (...a) => {
    created.push(a[0]);
    return realCreate(...a);
  };
  try {
    for (let i = 0; i < 60; i++) ud.update(1 / 60, ac, WEATHER(0), sim);
  } finally {
    global.document.createElement = realCreate;
  }
  ok(`${id}: no canvas or element is made while flying`, created.length === 0, `${created.length} made`);
  const displays = ud.displays || [];
  const shown = ud.bus ? ud.bus.data.shown : {};
  ok(`${id}: every screen has painted`, displays.length > 0 && displays.every((d) => d.paints > 0), displays.map((d) => `${d.name}:${d.paints}`).join(' '));
  const want = { ias: Math.round(120 * KTS), alt: Math.round(900 * FT), hdg: 123 };
  const read = Object.entries(shown).filter(([, v]) => v && typeof v === 'object' && 'ias' in v);
  if (HELIS.includes(id)) {
    // The helicopter flies on round dials (gauges.js): their readings.
    const sm = ud.panel.smooth;
    ok(`${id}: the dials read the machine's own speed, height and heading`, Math.abs(sm.ias - 120 * KTS) < 1 && Math.abs(sm.alt - 900 * FT) < 5 && Math.abs(sm.hdg - 123) < 1, `${sm.ias.toFixed(0)} kt ${sm.alt.toFixed(0)} ft ${sm.hdg.toFixed(0)}°`);
  } else {
    ok(`${id}: the flight screens show the aeroplane's own speed, height and heading`, read.length > 0 && read.every(([, v]) => v.ias === want.ias && v.alt === want.alt && v.hdg === want.hdg), JSON.stringify(read.map(([n, v]) => [n, v.ias, v.alt, v.hdg])) + ' want ' + JSON.stringify(want));
  }
  if (shown.mcp) ok(`${id}: the autopilot panel shows the autopilot's own selections`, shown.mcp.hdg === 250 && shown.mcp.alt === 5000 && shown.mcp.spd === 210, JSON.stringify(shown.mcp));
  if (shown.eicas) {
    const nEng = ud.deck ? ud.deck.engines : id === 'nightjar' ? 4 : 2;
    ok(`${id}: the engine page has a dial per engine (${nEng})`, shown.eicas.n1.length === nEng && shown.eicas.n1.every((n) => n > 20 && n < 105), JSON.stringify(shown.eicas.n1));
  }
  if (shown.nd || shown.map) ok(`${id}: the map knows where the target is`, Number.isFinite((shown.nd || shown.map).nm), JSON.stringify(shown.nd || shown.map));
  // About 12 Hz each, spread out: over a further second.
  {
    // What moves keeps its mesh: kit.js mergeStatic once took every gauge
    // needle off its pivot (the pivot turned, the needle stayed painted where
    // it was built) and the red OFF flags, hidden until a blackout, into a
    // mesh that was always shown.
    const pose = (o) => [...o.position.toArray(), o.rotation.x, o.rotation.y, o.rotation.z, ...o.scale.toArray()].map((n) => n.toFixed(5)).join(',');
    const posed = new Map();
    cockpit.traverse((o) => posed.set(o, pose(o)));
    const movedLater = () => {
      const moved = [];
      cockpit.traverse((o) => { if (posed.has(o) && posed.get(o) !== pose(o)) moved.push(o); });
      return moved;
    };
    globalThis.__movedLater = movedLater;
    // Flying: every number on every screen changing.
    const before = displays.map((d) => d.paints);
    let most = 0;
    const bank0 = ac.bankAngleDeg;
    for (let i = 0; i < 60; i++) {
      const p0 = displays.reduce((a, d) => a + d.paints, 0);
      ac.alt += 3;
      ac.ias += 0.3;
      ac.heading = (ac.heading + 1) % 360;
      ac.fuelFraction = () => 0.6 - i * 0.001;
      ac.bankAngleDeg = () => Math.sin(i / 5) * 20;
      sim.autopilot.selectedHeadingDeg = (250 + i) % 360;
      ud.update(1 / 60, ac, WEATHER(0), sim);
      most = Math.max(most, displays.reduce((a, d) => a + d.paints, 0) - p0);
    }
    ac.bankAngleDeg = bank0;
    {
      const moved = globalThis.__movedLater();
      // A gauge's needle lives in the panel's one needle mesh (gauges.js
      // _batch): its pivot counts as having its mesh if that mesh is in the
      // cockpit and has been moved to where the pivot points.
      const inCockpit = (m) => { let p = m; while (p && p !== cockpit) p = p.parent; return p === cockpit; };
      const bare = moved.filter((o) => {
        let n = 0;
        // A mesh a camera draws (layer 0), or its part in the moving-parts
        // batch (kit.js batchMovers), checked to follow it below.
        o.traverse((c) => { if (c.isMesh && (c.layers.isEnabled(0) || (c.userData.batchedIn && inCockpit(c.userData.batchedIn)))) n++; });
        if (n) return false;
        const b = o.userData.batched;
        return !(b && b.isMesh && inCockpit(b) && b.geometry.attributes.position.version > 1);
      });
      ok(`${id}: everything the flight moves still has its mesh (nothing that moves was merged)`, moved.length > 0 && bare.length === 0, `${moved.length} moved, bare: ${bare.map((o) => o.name || o.type).join(',')}`);
      {
        const f = moversFollow(cockpit);
        ok(`${id}: the moving parts drawn as one are drawn where the pilot has moved them`, f.parts > 0 && f.worst < 1e-5, `${f.parts} parts in ${f.batches} draw(s), worst ${f.worst.toExponential(1)} m`);
      }
      if (ud.panel.batches && ud.panel.batches.length) {
        const f = needlesFollow(cockpit);
        ok(`${id}: every needle is drawn where its gauge points it`, f.worst < 1e-5, `${f.needles} needles, worst ${f.worst.toExponential(1)} m`);
      }
      const p = ud.panel;
      const lost = [...(p.flags || []), ...(p.lcds || [])].filter((m) => { let o = m; while (o && o !== cockpit) o = o.parent; return o !== cockpit; });
      ok(`${id}: the OFF flags and dead-screen covers are still their own (hidden) meshes`, lost.length === 0 && [...(p.flags || []), ...(p.lcds || [])].every((m) => m.visible === false), `${lost.length} lost`);
    }
    const per = displays.map((d, i) => d.paints - before[i]);
    // Each at its own rate (12 a second unless it says otherwise: the HUD 15,
    // a map 8, a page of text 4), give or take a frame or two.
    const rate = (d) => d.hz || 12;
    ok(`${id}: each screen repaints at its own rate (4 to 15 a second), at most two on any frame`, per.every((n, i) => n >= Math.floor(rate(displays[i]) * 0.65) && n <= Math.ceil(rate(displays[i]) * 1.25) + 1) && most <= 2, `${per.map((n, i) => `${n}/${rate(displays[i])}`).join(',')} / most ${most} a frame`);
    // Holding still: nothing new to show, so (almost) nothing is repainted —
    // no texture upload for a picture that has not changed.
    {
      for (let i = 0; i < 30; i++) ud.update(1 / 60, ac, WEATHER(0), sim);
      const p0 = displays.reduce((a, d) => a + d.paints, 0);
      for (let i = 0; i < 60; i++) ud.update(1 / 60, ac, WEATHER(0), sim);
      const p1 = displays.reduce((a, d) => a + d.paints, 0) - p0;
      ok(`${id}: a screen with nothing new to show is not repainted (at most once a second)`, p1 <= displays.length, `${p1} paints for ${displays.length} screens in a second`);
    }
    const c0 = process.cpuUsage();
    for (let i = 0; i < 300; i++) ud.update(1 / 60, ac, WEATHER(0.3), sim);
    const c1 = process.cpuUsage(c0);
    const ms = (c1.user + c1.system) / 1000 / 300;
    ok(`${id}: an update costs under 0.4 ms of CPU here (screens included)`, ms < 0.4, `${ms.toFixed(3)} ms`);
  }

  /* ---- The camera never clips the cockpit ---- */
  const vis = meshesOf(cockpit);
  for (const [view, p] of [['cockpit view', eye], ['realistic cockpit', eye.clone().add(REALISTIC_OFFSET)]]) {
    const n = nearest(p, vis);
    ok(`${id} (${view}): nothing within 10 cm of the eye, whichever way the head turns`, n.d > 0.1, `${n.d.toFixed(3)} m to ${n.what}`);
  }

  /* ---- The view out ---- */
  const opaque = opaqueOf(cockpit);
  const room = opaque.filter((m) => !/seat|headrest|cushion|back/i.test(m.name) && !/seat/.test(m.parent && m.parent.name));
  if (JETS.includes(id) && ud.canopy) {
    const q = ud.canopy;
    const mid = (q.z0 + q.z1) / 2;
    const half = (q.z1 - q.z0) / 2;
    const eyeM = model.worldToLocal(eye.clone());
    const onCanopy = (zm, a, f = 0.985) => {
      const e = Math.sqrt(Math.max(0, 1 - ((zm - mid) / half) ** 2));
      return model.localToWorld(new THREE.Vector3(q.width * e * Math.sin(a) * f, q.baseY + q.height * e * Math.cos(a) * f, zm));
    };
    const up = [];
    for (const dz of [-0.15, 0, 0.15, 0.3]) for (let a = -1.25; a <= 1.25001; a += 0.25) up.push(onCanopy(eyeM.z + dz, a));
    const fUp = clearFraction(eye, up, opaque);
    ok(`${id}: the canopy is open above the sill, round and over the pilot`, fUp >= 0.85, `${(fUp * 100).toFixed(0)}% of ${up.length}`);
    const ahead = [];
    // Up to 5 degrees over the horizon: higher than that, the bow crosses
    // the view on the types that have one, as it does in the real ones.
    for (const yaw of [-0.35, -0.2, 0, 0.2, 0.35]) for (const pitch of [-0.02, 0.04, 0.09]) ahead.push(eye.clone().add(new THREE.Vector3(Math.sin(yaw) * 4, Math.tan(pitch) * 4, -Math.cos(yaw) * 4)));
    const fAhead = clearFraction(eye, ahead, opaque);
    ok(`${id}: straight ahead over the glareshield is open (the HUD's glass is glass)`, fAhead >= 0.85, `${(fAhead * 100).toFixed(0)}%`);
    const below = [];
    for (const dz of [-0.2, 0, 0.2]) for (const sgn of [-1, 1]) {
      const zm = eyeM.z + dz;
      const e = Math.sqrt(Math.max(0, 1 - ((zm - mid) / half) ** 2));
      below.push(model.localToWorld(new THREE.Vector3(sgn * q.width * e * 0.95, q.baseY - 0.12, zm)));
      below.push(model.localToWorld(new THREE.Vector3(sgn * q.width * e * 0.6, eyeM.y - 1.25, zm)));
    }
    const fBelow = clearFraction(eye, below, opaque, 0.002);
    ok(`${id}: below the sill it is all cockpit — no sky through the tub`, fBelow <= 0.02, `${(fBelow * 100).toFixed(0)}% seen through`);
  }
  if (AIRLINERS.includes(id)) {
    const fd = model.userData.flightDeck;
    const h = fd.hull || model.userData.cabinHull;
    const P = new THREE.Vector3();
    model.updateMatrixWorld(true);
    fd.quads.forEach((q, i) => {
      for (const sgn of [1, -1]) {
        const c = q.quad;
        const pts = [];
        for (const u of [0.25, 0.5, 0.75]) for (const v of [0.25, 0.5, 0.75]) {
          const z = (1 - v) * ((1 - u) * c[0][0] + u * c[1][0]) + v * ((1 - u) * c[3][0] + u * c[2][0]);
          const sv = (1 - v) * ((1 - u) * c[0][1] + u * c[1][1]) + v * ((1 - u) * c[3][1] + u * c[2][1]);
          pts.push(h.point(z, sgn * sv, P).clone().applyMatrix4(model.matrixWorld));
        }
        // Through the glass and three metres on: the view OUT, not just to the pane.
        const beyond = pts.map((p) => p.clone().sub(eye).multiplyScalar(1 + 3 / p.distanceTo(eye)).add(eye));
        const f = clearFraction(eye, beyond, i === 0 ? opaque : room);
        const need = i === 0 ? 0.7 : 0.45;
        ok(`${id}: ${q.name} ${sgn > 0 ? 'right' : 'left'} is open from the captain's seat, out to the sky`, f >= need, `${(f * 100).toFixed(0)}% of ${pts.length}`);
      }
    });
    // The walls: hull points round the deck, outside every pane's frame,
    // above the floor, must all be behind cockpit.
    const eyeM = model.worldToLocal(eye.clone());
    const yFloorM = eyeM.y - 1.1 / k;
    const zs = fd.quads.flatMap((q) => q.quad.map((c) => c[0]));
    const zA = Math.min(...zs) - 0.1 / k;
    const zB = eyeM.z + 1.0 / k;
    const near = (z, sv) => fd.quads.some((q) => {
      const zz = q.quad.map((c) => c[0]);
      const ss = q.quad.map((c) => c[1]);
      // (The A350's mask frame is 20 cm wide: a margin of its whole width would leave no wall to sample.)
      const m = Math.min(q.frame, 0.08) * 2.5;
      return z > Math.min(...zz) - m && z < Math.max(...zz) + m && Math.abs(sv) > Math.min(...ss) - m * 2 && Math.abs(sv) < Math.max(...ss) + m * 2;
    });
    const list = [];
    for (let z = zA; z <= zB; z += 0.15 / k) for (let sv = -2.6; sv <= 2.6; sv += 0.13) {
      if (near(z, sv)) continue;
      if (h.point(z, sv, P).y < yFloorM) continue;
      list.push([z, sv]);
    }
    const skin = hullPoints(model, h, list, 0);
    const seen = [];
    const leak = clearFraction(eye, skin, opaque, 0.002, seen);
    if (DEBUG && seen.length) console.log(id, 'skin seen:', seen.slice(0, 12).map((p) => model.worldToLocal(p.clone()).toArray().map((v) => v.toFixed(2)).join(',')).join('  '));
    // A deck that is panes and frames from end to end (the An-225's, its
    // windscreen running 1.4 m down the forehead) leaves no wall outside the
    // frames' margins to sample; the panes themselves are checked above.
    ok(`${id}: no daylight through the flight deck's walls`, skin.length === 0 || leak <= 0.01, skin.length ? `${(leak * 100).toFixed(1)}% of ${skin.length} skin points seen straight through` : 'no wall outside the panes to sample');
    // The room is as wide as the real aeroplane's nose lets it be: measured at
    // the eye, between 45 % and 100 % of the published fuselage width (the
    // pilots sit in the nose's taper; an upper-deck cockpit on the hump).
    const real = REAL_WIDTH[id];
    const ratio = ud.deck.width / real;
    ok(`${id}: the flight deck is a room, ${ud.deck.width.toFixed(2)} m wide at the eye, in band for a ${real} m fuselage`, ratio > 0.45 && ratio <= 1.0, `${ud.deck.width.toFixed(2)} m = ${ratio.toFixed(2)} of ${real} m`);
    const want = DECK_CHARACTER[id];
    ok(`${id}: the deck has the real aeroplane's controls (${want.stick}, ${want.engines} thrust levers)`, ud.deck.stick === want.stick && ud.controls.levers.length === want.engines && (want.stick === 'yoke' ? ud.controls.yokes.length === 2 : ud.controls.sticks.length === 2), `${ud.deck.stick} ${ud.controls.levers.length} levers ${ud.controls.yokes.length} yokes ${ud.controls.sticks.length} sticks`);
    if (want.hud) ok(`${id}: a head-up display hangs in front of the captain, painting`, !!ud.hud && ud.hud.paints > 0 && ud.hud.mesh.parent === cockpit && Math.abs(ud.hud.mesh.position.x - eye.x / k + TRAINER_EYE[0]) < 0.5, ud.hud && `${ud.hud.paints} paints`);
    else ok(`${id}: no head-up display`, !ud.hud);
    if (want.levers === 'turboprop') ok(`${id}: condition levers behind the power levers`, ud.controls.conds.length === want.engines);
    // The gear lever follows the wheels.
    {
      const gl = ud.controls.gear;
      const acG = { ...ac, gearDown: true };
      for (let i = 0; i < 60; i++) ud.update(1 / 60, acG, WEATHER(0), sim);
      const down = gl.position.y;
      acG.gearDown = false;
      for (let i = 0; i < 60; i++) ud.update(1 / 60, acG, WEATHER(0), sim);
      ok(`${id}: the gear lever moves with the gear`, gl.position.y - down > 0.05, `${(gl.position.y - down).toFixed(3)} m`);
    }
  }
  if (HELIS.includes(id)) {
    const shell = ud.shell;
    const chin = shell.openings.find((o) => o.from === 'chinTop' || /chin/i.test(o.name || ''));
    const tandem = !!(ud.character && ud.character.tandem);
    ok(`${id}: the room is cut from the machine's own hull`, ud.glazing.source === 'hull' && shell.openings.length >= (tandem ? 2 : 4), `${ud.glazing.source}, ${shell.openings.length} openings`);
    ok(`${id}: ${tandem ? 'one seat a row (tandem)' : 'two seats side by side'}`, meshesOf(cockpit).filter((m) => /anti-torque pedal/.test(m.name)).length === (tandem ? 2 : 4) || meshesOf(cockpit).some((m) => m.isSkinnedMesh));
    // Straight ahead is the outside, and the screens are in sight: the
    // Apache's pilot once looked into the roof strip of his canopy, with his
    // panel hidden behind the divider and the overhead strip across his chest.
    {
      const ahead = [0, 5].map((deg) => {
        const r = (deg * Math.PI) / 180;
        return eye.clone().addScaledVector(new THREE.Vector3(0, Math.sin(r), -Math.cos(r)).transformDirection(model.matrixWorld), 3);
      });
      const fAhead = clearFraction(eye, ahead, opaque);
      const screens = (ud.displays || []).map((d) => d.mesh.getWorldPosition(new THREE.Vector3()));
      const fScreens = clearFraction(eye, screens, opaque.filter((m) => !m.userData.display), 0.03);
      ok(`${id}: straight ahead over the hood is the outside`, fAhead === 1, `${(fAhead * 100).toFixed(0)}% of 0/5 degrees clear`);
      ok(`${id}: the screens can be seen from the seat`, fScreens >= 0.5, `${(fScreens * 100).toFixed(0)}% of ${screens.length}`);
    }
    const h = (model.userData.cabinHull) || null;
    // The chin windows at the pilot's feet, where this machine has them (the
    // R44 and the Apache have none): sampled on the exterior's own chin
    // window lines, they must be open from the seat.
    const chinWin = h && h.glazing && h.glazing.windows.find((w) => w.from === 'chinTop');
    if (h && chinWin) {
      const P = new THREE.Vector3();
      const lv = (name, z) => { const l = h.glazing.lines[name]; return typeof l === 'function' ? l(z) : l; };
      const pts = [];
      for (let i = 0; i < 3; i++) {
        const z = lerp(chinWin.z0, chinWin.z1, 0.25 + i * 0.25);
        const sMid = (lv('chinTop', z) + lv('chinBot', z)) / 2;
        for (const sgn of [-1, 1]) pts.push(h.point(z, sgn * sMid, P).clone().applyMatrix4(model.matrixWorld));
      }
      const f = clearFraction(eye, pts, opaque);
      ok(`${id}: the chin bubbles are open at the pilot's feet`, f >= 0.3, `${(f * 100).toFixed(0)}% of ${pts.length}`);
    } else if (h) {
      ok(`${id}: no chin windows outside, none cut inside`, !chin, `${shell.openings.length} openings`);
    }
    void chin;
  }

  /* ---- The HUD's horizon is the horizon ---- */
  if (ud.hud) {
    const hud = ud.hud;
    const geo = hud.mesh.geometry.parameters;
    const W = hud.W; // the painter's own (logical) width
    for (const real of [false, true]) {
      sim.settings.realisticCockpit = real;
      hud.paint({ ...ud.bus.data, realistic: real, shown: {} }, {});
      const e = real ? eye.clone().add(REALISTIC_OFFSET) : eye;
      const hp = hud.mesh.getWorldPosition(new THREE.Vector3());
      const D = e.z - hp.z;
      const px10 = hud.userData.ppd * 10; // canvas px for 10 degrees
      const metres = (px10 / W) * geo.width;
      const deg = (Math.atan2(metres, D) * 180) / Math.PI;
      const boreM = hud.userData.boreY * geo.height;
      const topY = hp.y + geo.height / 2;
      ok(`${id} (${real ? 'realistic' : 'cockpit'} view): ten degrees on the HUD is ten degrees from the eye`, Math.abs(deg - 10) < 0.25, deg.toFixed(2));
      ok(`${id} (${real ? 'realistic' : 'cockpit'} view): the HUD's boresight is at the eye's height`, Math.abs(topY - boreM - e.y) < 0.005, `${(topY - boreM).toFixed(3)} vs ${e.y.toFixed(3)}`);
    }
    sim.settings.realisticCockpit = false;
  }

  /* ---- The exterior's canopy, from inside and out ---- */
  {
    const hidden = [];
    model.traverse((o) => o.isMesh && o.userData.seeThrough && hidden.push(o));
    if (JETS.includes(id)) ok(`${id}: the exterior's own glass is fitted to vanish from inside`, hidden.length > 0, `${hidden.length} meshes`);
    if (hidden.length) {
      const m = hidden[0];
      const mat = Array.isArray(m.material) ? m.material[0] : m.material;
      const cam = new THREE.PerspectiveCamera();
      cam.position.copy(eye);
      cam.updateMatrixWorld(true);
      m.onBeforeRender(null, null, cam, m.geometry, mat, null);
      const inside = mat.colorWrite === false;
      m.onAfterRender(null, null, cam, m.geometry, mat, null);
      const restored = mat.colorWrite !== false;
      cam.position.copy(eye).add(new THREE.Vector3(0, 6, 30));
      cam.updateMatrixWorld(true);
      m.onBeforeRender(null, null, cam, m.geometry, mat, null);
      const outside = mat.colorWrite !== false;
      m.onAfterRender(null, null, cam, m.geometry, mat, null);
      ok(`${id}: ...hidden from a camera at the eye, put back after, and drawn for a camera outside`, inside && restored && outside, `${inside} ${restored} ${outside}`);
    }
  }

  /* ---- The exterior's insides, cut away from inside only ---- */
  {
    const carved = [];
    model.traverse((o) => o.isMesh && o.userData.carved && carved.push(o));
    if (JETS.includes(id) || id === 'b747') ok(`${id}: the exterior's parts that reach into the cockpit are cut from inside`, carved.length > 0, `${carved.length} meshes`);
    if (carved.length) {
      const m = carved[0];
      const mat = Array.isArray(m.material) ? m.material[0] : m.material;
      const planes = mat.clippingPlanes;
      const cam = new THREE.PerspectiveCamera();
      const clippedAt = (p) => planes.every((pl) => pl.distanceToPoint(p) < 0);
      // A point a few cm under the eye, inside the cockpit's box.
      const probe = eye.clone().add(new THREE.Vector3(0, -0.3, -0.2));
      cam.position.copy(eye);
      cam.updateMatrixWorld(true);
      m.onBeforeRender(null, null, cam, m.geometry, mat, null);
      const inside = clippedAt(probe);
      cam.position.copy(eye).add(new THREE.Vector3(0, 8, 40));
      cam.updateMatrixWorld(true);
      m.onBeforeRender(null, null, cam, m.geometry, mat, null);
      const outside = !clippedAt(probe);
      ok(`${id}: ...cut for a camera at the eye, whole for a camera outside, the same shader both ways`, planes.length === 6 && mat.clipIntersection === true && inside && outside, `${inside} ${outside}`);
    }
  }

  if (ud.viewing) {
    const vis = () => { let n = 0; model.traverse((o) => { if (o.isMesh && o.visible) n++; }); return n; };
    const before = vis();
    ud.viewing(true);
    const seated = vis();
    ud.viewing(false);
    const after = vis();
    ok(`${id}: in the seat, the exterior parts that cannot be seen from it are not drawn; out of it, all are back`, seated <= before && after === before, `${before} -> ${seated} -> ${after}`);
  }

  /* ---- Behaviours ---- */
  {
    const acF = fakeAc({ failures: { engine: true }, quat: new THREE.Quaternion(), vel: new THREE.Vector3(0, 0, -50) });
    const simF = fakeSim();
    for (let i = 0; i < 10; i++) ud.update(1 / 60, acF, WEATHER(0), simF);
    const eng = ud.warnings.find((l) => l.key === 'engine');
    ok(`${id}: the ENGINE lamp lights for an engine failure`, eng.mat.emissiveIntensity > 1);
    let flashed = false;
    const master = cockpit.getObjectByName('master caution');
    for (let i = 0; i < 60; i++) {
      ud.update(1 / 60, acF, WEATHER(0), simF);
      if (master.material.emissiveIntensity > 1) flashed = true;
    }
    ok(`${id}: and the master caution flashes`, flashed);
    const ap = allMeshes(cockpit).find((m) => /^lamp (AP|A\/P|HOLD)$/.test(m.name));
    ok(`${id}: the autopilot lamp is lit while the autopilot flies`, ap && ap.material.emissiveIntensity > 1, ap && ap.name);
    simF.autopilot.engaged = false;
    ud.update(1 / 60, acF, WEATHER(0), simF);
    ok(`${id}: ...and dark when it does not`, ap && ap.material.emissiveIntensity === 0);
    simF.instrumentBlackout = 5;
    for (let i = 0; i < 4; i++) ud.update(1 / 60, acF, WEATHER(0), simF);
    ok(`${id}: in a blackout every screen goes black and the lamps go out`, displays.every((d) => d.dead || d.hud) && displays.filter((d) => !d.hud).every((d) => d.material.emissiveIntensity === 0) && eng.mat.emissiveIntensity === 0);
    simF.instrumentBlackout = 0;
    for (let i = 0; i < 30; i++) ud.update(1 / 60, acF, WEATHER(0), simF);
    ok(`${id}: ...and they come back with the power`, displays.every((d) => !d.dead) && displays.filter((d) => !d.hud).every((d) => d.material.emissiveIntensity > 0.3));
    // Controls.
    const ctl = ud.controls;
    acF.controls.pitch = 1;
    acF.controls.roll = 1;
    acF.controls.throttle = 1;
    for (let i = 0; i < 60; i++) ud.update(1 / 60, acF, WEATHER(0), simF);
    const moved = [];
    if (ctl.stick) moved.push(['stick', Math.abs(ctl.stick.rotation.x) > 0.15 && Math.abs(ctl.stick.rotation.z) > 0.15]);
    if (ctl.sticks) for (const st of ctl.sticks) moved.push(['stick', Math.abs(st.rotation.x) > 0.15]);
    if (ctl.throttle) moved.push(['throttle', ctl.throttle.userData.lever.position.z < -0.05]);
    if (ctl.levers) for (const lv of ctl.levers) moved.push(['thrust lever', lv.rotation.x < -0.2]);
    if (ctl.yokes) for (const y of ctl.yokes) moved.push(['yoke', y.userData.wheel.rotation.z < -0.5]);
    if (ctl.cyclic) moved.push(['cyclic', Math.abs(ctl.cyclic.rotation.x) > 0.15]);
    if (ctl.collective) moved.push(['collective', ctl.collective.rotation.x > 0.3]);
    ok(`${id}: the controls move with the pilot's hands`, moved.length >= 2 && moved.every(([, m]) => m), moved.map(([n, m]) => `${n}:${m}`).join(' '));
    ok(`${id}: no NaN after flying`, nanCount(cockpit) === 0);
  }
}

/* ------------------------------------------------------------------ *
 * 8. The view out of the windscreen (the wave-8 cockpit check)
 *
 * From the pilot's eye, straight ahead: how many degrees of clear glass
 * there are above the eye line before the windscreen's top frame (or the
 * overhead panel, the HUD's projector) crosses the view, and how far the
 * view drops below it before the glareshield, the sill's frame or the nose
 * gets in the way. The An-225's windscreen top sat AT the eye (the overhead
 * hung into the top third of the picture); the C-17's nose came up 5
 * degrees under the horizon, where a 3-degree approach puts the runway.
 *
 * Measured as the checker measured it: rays from the eye, half a degree
 * apart, against everything opaque in the cockpit and the exterior's own
 * skin beyond the glass (its front faces, more than 1.2 m out — the carved
 * parts round the eye are clipped away in the renderer), with the exterior
 * in its seated state (userData.viewing). Five yaws across the windscreen,
 * the median, so one post or wiper does not decide it.
 *
 * The bands are the cockpit view's; the realistic view (16 cm back, 2 cm
 * lower) gets 3 degrees of slack. Every eye stays 10 cm clear of the room.
 * ------------------------------------------------------------------ */
const { VIEW_PITCH_MAX } = await import(SRC + 'aircraft/cockpit/flightdeck.js');
/** Least clear windscreen above the eye line / least nose-drop below it, degrees, cockpit view. */
const VIEW_BANDS = {
  // Wave 9 moved these eyes (and widened four giants' windscreen inboard
  // corners); measured after the move, a degree or two under what they give.
  an225: { above: 12, below: 9 }, // was 0 / 0: the eye sat at the windscreen's top
  c5: { above: 13, below: 9 }, // was 1 / 6.5
  c17: { above: 11, below: 10 }, // was 6 / 5
  b1b: { above: 8, below: 6 }, // was 2.5 / 2: the slender nose allows no more
  concorde: { above: 9, below: 7 }, // was 4.5 / 2: the visor's small panes
  b737: { above: 14, below: 13 }, // was 27 / 8
  q400: { above: 11, below: 10 }, // was 26 / 7.5
  meridian: { above: 12, below: 10 }, // was 2.5 / 12
  courier: { above: 17, below: 8 }, // was 18 / 3.5
  // Unchanged, held where they were.
  b747: { above: 20, below: 14 },
  dreamlifter: { above: 20, below: 14 },
  a320: { above: 22, below: 9 },
  a321: { above: 22, below: 9 },
  a380: { above: 27, below: 13 },
  b777: { above: 22, below: 9 },
  belugaxl: { above: 21, below: 9 },
  skylark: { above: 19, below: 7 },
  // Not held: the 787 and the A350. From the captain's seat (x -0.76) the
  // sweep meets the deck skin 1.7-2 m out at every pitch — the smooth nose's
  // windscreen cut-out wants a look of its own (their panes' lower edges are
  // open to the sky, cockpits.mjs above, so it is the cut at the eye's x).
};

/** { above, below } for the view from `from`, degrees; `near` the closest cockpit surface. */
function viewOut(s, from) {
  const { model, cockpit } = s;
  const ud = cockpit.userData;
  const opaque = opaqueOf(cockpit);
  const ext = [];
  model.traverse((o) => {
    if (!o.isMesh || o.userData.seeThrough) return;
    const mat = Array.isArray(o.material) ? o.material[0] : o.material;
    if (mat && mat.transparent) return;
    for (let p = o; p; p = p.parent) if (!p.visible || p === cockpit) return;
    ext.push(o);
  });
  const fwd = new THREE.Vector3();
  const first = (pitchDeg, yawDeg) => {
    const p = (pitchDeg * Math.PI) / 180;
    const y = (yawDeg * Math.PI) / 180;
    fwd.set(Math.sin(y) * Math.cos(p), Math.sin(p), -Math.cos(p) * Math.cos(y)).transformDirection(model.matrixWorld);
    ray.set(from, fwd);
    ray.near = 0.01;
    ray.far = 8;
    if (ray.intersectObjects(opaque, false).length) return true;
    return ray.intersectObjects(ext, false).some((h) => h.distance > 1.2);
  };
  // The first angle from which the view stays blocked for 2 degrees (four
  // steps): a wiper blade or a post is seen past; a frame, and the skin
  // behind it, is not.
  const sweep = (sgn, yaw) => {
    let run = 0;
    let start = 60;
    for (let a = 0; a <= 62; a += 0.5) {
      if (!first(sgn * a, yaw)) {
        run = 0;
        continue;
      }
      if (!run) start = a;
      if (++run >= 4) return start;
    }
    return 60;
  };
  const med = (xs) => xs.slice().sort((a, b) => a - b)[Math.floor(xs.length / 2)];
  const yaws = [-6, -3, 0, 3, 6];
  return { above: med(yaws.map((y) => sweep(1, y))), below: med(yaws.map((y) => sweep(-1, y))), near: nearest(from, meshesOf(cockpit)).d, viewPitch: ud.viewPitchDeg || 8 };
}

for (const [id, band] of Object.entries(VIEW_BANDS).filter(([i]) => !ONLY || ONLY.includes(i))) {
  let s;
  try {
    s = seated(id);
  } catch (e) {
    ok(`${id}: builds`, false, e && e.message);
    continue;
  }
  const ud = s.cockpit.userData;
  if (ud.viewing) ud.viewing(true);
  try {
    for (const [view, from, slack] of [['cockpit view', s.eye, 0], ['realistic cockpit', s.eye.clone().add(REALISTIC_OFFSET), 3]]) {
      const v = viewOut(s, from);
      ok(`${id} (${view}): ${band.above - slack}+ degrees of clear windscreen above the eye line`, v.above >= band.above - slack, `${v.above} degrees`);
      ok(`${id} (${view}): the nose drops ${band.below - slack}+ degrees below the eye line (a 3-degree approach shows the runway over the glareshield)`, v.below >= band.below - slack, `${v.below} degrees`);
      ok(`${id} (${view}): the eye is 10 cm clear of the room`, v.near >= 0.1, `${v.near.toFixed(3)} m`);
    }
  } finally {
    if (ud.viewing) ud.viewing(false);
  }
  // The default view looks down at most VIEW_PITCH_MAX degrees: at 20 the
  // 747's and the Q400's horizons sat a fifth of the way down the picture.
  ok(`${id}: the default cockpit view looks down at most ${VIEW_PITCH_MAX} degrees`, (ud.viewPitchDeg || 8) <= VIEW_PITCH_MAX, `${(ud.viewPitchDeg || 8).toFixed(1)} degrees`);
  // ...and the screens are still in it. The airliner panel hangs under the
  // windscreen's sill, so an eye moved up or forward for the view over the
  // nose looks down on it more steeply: with the 15-degree cap, eyes moved
  // that far (wave 9's first C-17, 737, Q400 and Meridian eyes) left the
  // captain's PFD 0-40 % inside the bottom of the picture, where v72 showed
  // all of it. Vertical field of view: 68 degrees at rest in the cockpit
  // view, 56 in the realistic one (flight/camera.js).
  const pfd = [];
  s.cockpit.traverse((o) => {
    if (o.isMesh && o.name === 'display captain PFD') pfd.push(o);
  });
  if (pfd.length) {
    const box = new THREE.Box3();
    for (const o of pfd) box.expandByObject(o);
    const zc = (box.min.z + box.max.z) / 2;
    const vp = ud.viewPitchDeg || 8;
    for (const [view, from, half, need] of [['cockpit view', s.eye, 34, 0.9], ['realistic cockpit', s.eye.clone().add(REALISTIC_OFFSET), 28, 0.6]]) {
      const down = (y) => (Math.atan2(from.y - y, from.z - zc) * 180) / Math.PI;
      const top = down(box.max.y);
      const bot = down(box.min.y);
      const inView = Math.max(0, Math.min(1, (vp + half - top) / (bot - top)));
      ok(`${id} (${view}): the captain's PFD is in the default view (${need * 100}%+ of it)`, inView >= need, `${(inView * 100).toFixed(0)}% (${top.toFixed(0)}-${bot.toFixed(0)} degrees down, the picture's bottom edge ${(vp + half).toFixed(0)})`);
    }
  }
}

/* ---- Big aeroplanes, big flight decks ---- */
{
  const w = {};
  for (const id of AIRLINERS) {
    try {
      w[id] = seated(id).cockpit.userData.deck.width;
    } catch (e) {
      w[id] = 0;
    }
  }
  ok('the 747 and the A380 have the widest flight decks, the Meridian the narrowest', w.b747 > w.a320 && w.a380 > w.a320 && w.a320 > w.meridian, JSON.stringify(Object.fromEntries(Object.entries(w).map(([k2, v]) => [k2, +v.toFixed(2)]))));
  const mx = (ids) => Math.max(...ids.map((i) => w[i]));
  const mn = (ids) => Math.min(...ids.map((i) => w[i]));
  ok('regional decks < narrow-body decks < wide-body decks, like the aeroplanes', mx(['q400', 'meridian', 'concorde', 'b1b']) < mn(['a320', 'a321', 'b737']) && mx(['a320', 'a321', 'b737']) < mn(['b787', 'a350', 'b777', 'b747', 'a380', 'c17', 'an225', 'c5', 'belugaxl', 'dreamlifter']), JSON.stringify(Object.fromEntries(Object.entries(w).map(([k2, v]) => [k2, +v.toFixed(2)]))));
}

/*
 * Measured between frames, the aeroplane is its own size. Games measure the
 * model with Box3.setFromObject while the sim steps and nothing has drawn
 * (PvP's size of your ride: its pellets leave from the nose's side, its
 * bumps reach that far). The cockpit's moving parts are skinned meshes whose
 * bounds three works out through a bind matrix only a draw refreshes; moved
 * 3.6 km, the Skylark measured 1.8 km across and no pellet hit a friend.
 */
{
  const THREE_SIZE = (o) => new THREE.Box3().setFromObject(o).getBoundingSphere(new THREE.Sphere()).radius;
  const far = [];
  let skinned = 0;
  for (const id of ['skylark', 'harrier', 'fa18', 'a320']) {
    const { model } = seated(id);
    model.traverse((o) => o.isSkinnedMesh && skinned++);
    model.position.set(3000, 500, -2000);
    model.quaternion.setFromEuler(new THREE.Euler(0.1, 2.2, 0.3));
    // No updateMatrixWorld: what a step between frames sees...
    const r1 = THREE_SIZE(model);
    // ...against the same pose with every matrix fresh (as after a draw).
    model.updateMatrixWorld(true);
    const r2 = THREE_SIZE(model);
    far.push([id, +r1.toFixed(2), +r2.toFixed(2)]);
  }
  ok('between frames, far from the origin, the aeroplane with its cockpit measures what it does after a draw (the moving parts keep their own bounds)',
    skinned > 0 && far.every(([, a, b]) => Math.abs(a - b) < 0.05 && a < 40), `${skinned} skinned; ` + far.map((f) => f.join(' ')).join(', '));
}

/* ------------------------------------------------------------------ *
 * 6. Fallbacks
 * ------------------------------------------------------------------ */
{
  const { cockpit } = seated('skylark', { model: null });
  ok('skylark with no model: still a light cockpit, on a default cabin', cockpit.userData.builder === 'light:skylark' && cockpit.userData.glazing.source === 'default');
}
{
  adapter.setFleetModels(true);
  try {
    const s = seated('courier');
    ok('courier drawn by the fleet pack: a light cockpit cut to the pack\'s canopy', s.cockpit.userData.builder === 'light:courier' && s.cockpit.userData.glazing.source === 'pack' && nanCount(s.cockpit) === 0, s.cockpit.userData.glazing.source);
  } finally {
    adapter.setFleetModels(false);
  }
}
{
  // A builder that throws must not take the cockpit view away.
  const type = getAircraft('skylark');
  const broken = { ...type, id: 'skylark-broken', class: 'Trainer' };
  CP.registerCockpitBuilder('light', () => {
    throw new Error('deliberately broken');
  });
  const warn = console.warn;
  console.warn = () => {};
  let c;
  try {
    c = CP.createCockpit({ type: broken, model: null });
  } finally {
    console.warn = warn;
  }
  ok('a light builder that throws falls back to the generic cockpit', c && c.userData.builder === 'generic');
}

/* ------------------------------------------------------------------ *
 * 13. The broken-cockpit pass (GM's audit, 2026-10-27; fixed 2026-10-30).
 * Each of these failed on v75.5.
 * ------------------------------------------------------------------ */
{
  // Section 12 left a deliberately broken light builder registered: the real one back.
  const { buildLightCockpit } = await import(SRC + 'aircraft/cockpit/light.js');
  CP.registerCockpitBuilder('light', buildLightCockpit, { name: 'light' });
  const byName = (cockpit, re) => {
    const out = [];
    cockpit.traverse((o) => { if (o.isMesh && re.test(o.name || '')) out.push(o); });
    return out;
  };
  // T-Pose Harrison: a view of his own — the visor readout and his arms —
  // not the generic box eject.js then hid.
  {
    const b = CP.builderFor(getAircraft('tpose'));
    ok("tpose: the 'none' family has its own builder (harrison)", !!b && b.name === 'harrison', b && b.name);
    const { cockpit } = seated('tpose');
    ok('tpose: built by it, with a HUD that paints and no room round it',
      String(cockpit.userData.builder) === 'harrison:tpose' && cockpit.userData.displays && cockpit.userData.displays.length === 1 && cockpit.userData.hud && cockpit.userData.hud.hud === true
        && byName(cockpit, /panel|glareshield|seat|floor|wall|frame/).length === 0, cockpit.userData.builder);
    ok('tpose: his two arms are in the picture, out to each side', byName(cockpit, /forearm/).length === 2 && byName(cockpit, /hand/).length === 2);
    const eject = readFileSync(new URL('../../src/features/eject.js', import.meta.url), 'utf8');
    ok('tpose: eject.js hides his head from inside, not his cockpit', /rig\.head\.visible = !inside/.test(eject) && !/sim\.cockpit\.visible = false/.test(eject));
  }
  // The Q400's overhead panel reads the right way up: the texture's top row
  // on the aft edge of the panel (the higher edge in the picture).
  {
    const { cockpit } = seated('q400');
    const oh = byName(cockpit, /^overhead panel$/)[0];
    let frontV = null;
    let aftV = null;
    if (oh) {
      const pos = oh.geometry.attributes.position;
      const uv = oh.geometry.attributes.uv;
      let zMin = Infinity; let zMax = -Infinity;
      for (let i = 0; i < pos.count; i++) { zMin = Math.min(zMin, pos.getZ(i)); zMax = Math.max(zMax, pos.getZ(i)); }
      for (let i = 0; i < pos.count; i++) {
        if (Math.abs(pos.getZ(i) - zMin) < 1e-6) frontV = uv.getY(i);
        if (Math.abs(pos.getZ(i) - zMax) < 1e-6) aftV = uv.getY(i);
      }
    }
    ok('q400: the overhead panel is textured top-aft (not upside down / mirrored from the seat)', !!oh && frontV === 0 && aftV === 1, `front v ${frontV}, aft v ${aftV}`);
  }
  // The Meridian's centre post is a post: the interior frame band is capped.
  {
    const { cockpit } = seated('meridian');
    const deck = cockpit.userData.deck;
    ok('meridian: built as a flight deck on its own hull', String(cockpit.userData.builder) === 'airliner:meridian' && deck && deck.source === 'hull', cockpit.userData.builder);
    const src = readFileSync(new URL('../../src/aircraft/cockpit/flightdeck.js', import.meta.url), 'utf8');
    ok('meridian: a civil hull\'s frame band is capped at 2 cm from inside', /Math\.min\(q\.frame, 0\.02 \/ k\)/.test(src));
  }
  // The 787's and the C-17's HUD hangs on a short bracket from a unit just over it, not a rod to the ceiling.
  for (const id of ['b787', 'c17']) {
    const { cockpit } = seated(id);
    const hud = cockpit.userData.hud;
    const br = hud && hud.userData && hud.userData.bracket;
    ok(`${id}: the HUD bracket is short (≤ 25 cm), the unit within 35 cm of the combiner's middle (not a rod to the ceiling)`,
      !!br && br.armLen <= 0.25 && br.unitAbove < 0.35, br ? `arm ${br.armLen.toFixed(3)} m, unit ${br.unitAbove.toFixed(2)} m over the combiner` : 'no bracket');
  }
  // Massimo's rails are dark trim, not racing red.
  {
    const { cockpit } = seated('massimo');
    const cn = cockpit.userData.canopy || {};
    const isRed = (hex) => ((hex >> 16) & 255) > 128 && ((hex >> 8) & 255) < 80;
    ok('massimo: the sill rails are not red bars across the bottom of the view', Number.isInteger(cn.rail) && !isRed(cn.rail), `rail #${(cn.rail || 0).toString(16)}`);
    ok('massimo: the rear arch keeps the racing red', Number.isInteger(cn.frame) && isRed(cn.frame), `frame #${(cn.frame || 0).toString(16)}`);
  }
  // The Chinook's and the Black Hawk's screens sit on the panel, inside the hood.
  for (const id of ['ch47', 'uh60', 'ah64']) {
    const { cockpit } = seated(id);
    const panel = cockpit.userData.panel;
    const screens = (cockpit.userData.displays || []).filter((d) => /PFD|ND/.test(d.name));
    const halfW = panel && panel.width ? panel.width / 2 : null;
    const outside = halfW == null ? screens : screens.filter((d) => Math.abs(d.mesh.position.x) + 0.06 > halfW + 1e-6);
    ok(`${id}: the PFD and the ND are inside the hood (half-width ${halfW && halfW.toFixed(2)} m)`, screens.length === 2 && outside.length === 0, screens.map((d) => `${d.name} ${d.mesh.position.x.toFixed(2)}`).join(', '));
  }
  // The light aeroplanes' sun visors: tinted, see-through, flush under the roof.
  for (const id of ['skylark', 'courier']) {
    const { cockpit } = seated(id);
    const vi = cockpit.userData.visors;
    ok(`${id}: the sun visors are tinted and see-through, flush under the roof, not a grey block`, !!vi && vi.count === 2 && vi.transparent && vi.opacity < 0.7 && !vi.textured && vi.underRoof <= 0.015, JSON.stringify(vi));
  }
  // The real skin arrives late: main.js rebuilds the cockpit over it.
  {
    const main = readFileSync(new URL('../../src/main.js', import.meta.url), 'utf8');
    ok('main.js watches the real skin (onRealSkin) and rebuilds the cockpit when it lands', /watchRealSkin\(model\)/.test(main) && /onRealSkin = \(\) =>/.test(main) && /remountCockpit\(\)/.test(main) && (main.match(/this\.watchRealSkin\(this\.model\)/g) || []).length >= 2);
  }
  // ...and a real skin's glass and frames are carved like any wall, while the
  // procedural exterior's (on the room's own openings) are kept.
  {
    const { carveExterior } = await import(SRC + 'aircraft/cockpit/kit.js');
    const model = new THREE.Group();
    const own = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 0.2), new THREE.MeshBasicMaterial());
    own.name = 'windscreen glass';
    own.position.x = -0.95; // across the room's edge: kept, because it is on the room's own opening
    model.add(own);
    const skin = new THREE.Group();
    skin.name = 'Real model';
    skin.userData.realModel = 'b737';
    const theirs = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 0.2), new THREE.MeshBasicMaterial());
    theirs.name = 'cockpit glass';
    skin.add(theirs);
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 0.2), new THREE.MeshBasicMaterial());
    post.name = 'window frame';
    post.position.x = 0.95; // across the edge too: carved, because it is the skin's, not the room's
    skin.add(post);
    model.add(skin);
    const box = new THREE.Box3(new THREE.Vector3(-1, -1, -1), new THREE.Vector3(1, 1, 1));
    const cut = carveExterior(model, box, (o) => /glass|frame/i.test(o.name));
    ok('a real skin\'s glass and frames inside the room are hidden or cut; the procedural exterior\'s glass is kept',
      cut.hidden.includes(theirs) && (cut.hidden.includes(post) || post.userData.carved) && !cut.hidden.includes(own) && !own.userData.carved, `hidden ${cut.hidden.map((o) => o.name).join(', ')}; carved ${cut.carved}`);
  }
}

const failed = results.filter((r) => !r.pass);
for (const r of results) console.log(`${r.pass ? 'ok  ' : 'FAIL'}  ${r.name}${r.detail ? '  — ' + r.detail : ''}`);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) process.exitCode = 1;

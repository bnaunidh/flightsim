/**
 * The three airliners, drawn at full size: Airbus A320, Boeing 747-400 and
 * Airbus A380. Same shape of entry as ../aircraft-combat.js and
 * ../aircraft-transport.js — ordered body stations, wing, tail, fin, gear,
 * engines and a decorate(ctx) for everything that makes the type itself.
 *
 * WHAT MAKES EACH ONE ITSELF, from 300 m and from the jet bridge:
 *
 *   A320  a slim tube; the Airbus nose — a blunt radome, the windscreen set
 *         at a break in the top line, six panes in a black frame with no
 *         eyebrow windows above them; two engines; sharklets
 *   747   the hump: a second, narrower loft on the first, its front the
 *         flight deck, the top line rising in one sweep from a low, round
 *         nose; a row of upper-deck windows; four engines; canted winglets
 *   A380  a fuselage taller than it is wide its whole length, the flight
 *         deck BETWEEN the decks so a tall forehead stands above the
 *         windscreen; two full rows of windows; four engines; wingtip fences
 *
 * THE REDO (brief item 1, "redo airliner models — like the cockpit and the
 * cockpit window"). Before it the nose was six rings of the pack's lathe —
 * a cone with a rounded tip — with dark patches laid on it for glass, and
 * the livery was mapped once per fuselage section, so the cheatline stopped
 * at every joint and the pack's light-aeroplane anti-glare patch sat on the
 * crown of each section. Now (./airliner-kit.js):
 *
 *   - the fuselage is the civil kit's hull: superellipse sections through a
 *     dense nose table drawn per type, cut into the pack's nose, cabin and
 *     tail sections afterwards so the crash code still breaks it up;
 *   - its livery is painted for the airframe — a cheatline that runs the
 *     length, a grey belly, every door's outline — in the type's colours or
 *     the game's livery scheme (cheatline colour, tail, registration);
 *   - the flight deck is six panes per type in black frames, dark tinted
 *     glass that reflects the sky, and a wiper on each windscreen;
 *   - cabin windows are rounded, one instanced draw for the aeroplane;
 *   - every passenger door and exit is a named group that opens
 *     (model.userData.doors; the table is AIRLINER_DOORS in
 *     ../../aircraft/extra/airliners.js);
 *   - the engines are high-bypass turbofans: lip, fan cowl, fan nozzle,
 *     core cowl, plug.
 *
 * GEOMETRY THAT THE FLIGHT MODEL SHARES. Tyre contact points, the belly, the
 * wing tips and the tail-strike point all come from AIRLINER_GEOMETRY in
 * ../../aircraft/extra/airliners.js, which is also what the physics shape is
 * derived from. The underside of each tail cone was drawn against the strike
 * angle: the physics tail point sits on the drawn underside, and the drawn
 * underside nowhere dips below the line from the main wheels at that angle —
 * measured in the test, tests/features/airliners.mjs, not asserted here.
 * The nose tip, the eye and the span are pinned there too; the redo moved
 * none of them.
 *
 * Proportions against the real aeroplanes (span : length):
 *   A320  35.80 × 37.57 m  0.953  (with sharklets)
 *   747   64.44 × 70.60 m  0.913  (-400, with winglets)
 *   A380  79.75 × 72.70 m  1.097
 */

import * as THREE from '../../vendor/three.module.js';
import { addInstanced } from '../common.js';
import { aircraftDecalTexture } from '../aircraft-textures.js';
import { AIRLINER_GEOMETRY as GEO } from '../../aircraft/extra/airliners.js';
import { hull, turned } from '../../aircraft/models/civil-kit.js';
import { textureTier } from '../../render/textures.js';
import {
  piecewise, loftFuselage, placeFuselage, splitByZ, liveryTexture, airlinerMaterials, glazing,
  windowRows, buildDoors, turbofan, registration, meshOf, remapUV, DECAL,
} from './airliner-kit.js';

const mix = (a, b, t) => a + (b - a) * t;
const clamp = THREE.MathUtils.clamp;

/* ------------------------------------------------------------------ *
 * Shared construction helpers. Everything here runs once, at build time.
 * ------------------------------------------------------------------ */

/**
 * A thin closed plate from a four-cornered outline — a winglet, a pylon, a
 * fence. Built as a triangle soup and every face turned to point away from
 * the plate's centre, which is right for anything convex.
 */
function plate(ctx, name, quad, thickness, mat, parent) {
  const q = quad.map((v) => new THREE.Vector3(...v));
  const n = new THREE.Vector3().subVectors(q[2], q[0]).cross(new THREE.Vector3().subVectors(q[3], q[1]));
  if (n.lengthSq() < 1e-12) n.set(0, 1, 0);
  n.normalize().multiplyScalar(thickness / 2);
  const top = q.map((v) => v.clone().add(n));
  const bot = q.map((v) => v.clone().sub(n));
  const c = new THREE.Vector3();
  for (const v of [...top, ...bot]) c.add(v);
  c.multiplyScalar(1 / 8);
  const tris = [
    [top[0], top[1], top[2]], [top[0], top[2], top[3]],
    [bot[0], bot[2], bot[1]], [bot[0], bot[3], bot[2]],
  ];
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    tris.push([top[i], bot[i], bot[j]], [top[i], bot[j], top[j]]);
  }
  const pos = [];
  const e1 = new THREE.Vector3();
  const e2 = new THREE.Vector3();
  const f = new THREE.Vector3();
  for (const [a, b, d] of tris) {
    e1.subVectors(b, a);
    e2.subVectors(d, a);
    f.crossVectors(e1, e2);
    if (f.lengthSq() < 1e-14) continue; // a triangle collapsed by a pointed outline
    const m = new THREE.Vector3().add(a).add(b).add(d).multiplyScalar(1 / 3).sub(c);
    if (f.dot(m) < 0) pos.push(a.x, a.y, a.z, d.x, d.y, d.z, b.x, b.y, b.z);
    else pos.push(a.x, a.y, a.z, b.x, b.y, b.z, d.x, d.y, d.z);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  const uvs = new Float32Array((pos.length / 3) * 2);
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geo.computeVertexNormals();
  return meshOf(ctx, name, geo, mat, parent);
}

function findByName(root, name) {
  let hit = null;
  root.traverse((o) => {
    if (!hit && o.name === name) hit = o;
  });
  return hit;
}

/** Wing numbers at spanwise station |x|, straight off the core's own formula. */
function wingAt(w, x) {
  const t = clamp((Math.abs(x) - w.rootX) / w.span, 0, 1);
  const chord = mix(w.rootChord, w.tipChord, t);
  const le = w.rootZ + (w.sweep || 0) * t;
  const mid = w.rootY + (w.dihedral || 0) * t;
  const th = mix(w.thickness || 0.12, w.tipThickness || 0.045, t);
  return { t, chord, le, te: le + chord, mid, under: mid - th / 2, top: mid + th / 2 };
}

/* ------------------------------------------------------------------ *
 * Tyres, bogies, legs.
 * ------------------------------------------------------------------ */

/**
 * A wheel, axle along X: the tyre's tread and sloping sidewalls in black and
 * the hub dish in grey, one lathe with vertex colours so a leg's wheels are
 * one instanced draw. Sixteen round — a multiple of four, which puts a vertex
 * at the very bottom (the tyre's lowest point is exactly -r, where the
 * physics has its contact); twelve read as a dodecagon in the hangar's gear
 * close-up.
 */
let _tyreGeos = new Map();
function tyreGeometry(r, width) {
  const key = `${r.toFixed(3)}|${width.toFixed(3)}`;
  if (_tyreGeos.has(key)) return _tyreGeos.get(key);
  const hub = r * 0.5;
  const w = width / 2;
  // Six points, five strips, 160 triangles a wheel: a 747 carries eighteen.
  const pts = [
    new THREE.Vector2(hub * 0.5, -w * 0.52), // hub face, dished in
    new THREE.Vector2(hub, -w * 0.66), // hub rim, where the sidewall starts
    new THREE.Vector2(r, -w), // shoulder
    new THREE.Vector2(r, w),
    new THREE.Vector2(hub, w * 0.66),
    new THREE.Vector2(hub * 0.5, w * 0.52),
  ];
  const g = new THREE.LatheGeometry(pts, 16);
  g.rotateZ(Math.PI / 2);
  // Colour by profile point: the two innermost rings each side are the hub.
  // (LatheGeometry lays its vertices segment-major: point j of segment i is
  // vertex i * points + j.)
  const n = g.attributes.position.count;
  const col = new Float32Array(n * 3);
  // Vertex colours are linear, not sRGB: the pack's rubber is #15171a, which
  // is 0.007 linear, and a hub of #999 is 0.32.
  for (let i = 0; i < n; i++) {
    const ring = i % pts.length;
    const isHub = ring <= 1 || ring >= pts.length - 2;
    const c = isHub ? 0.32 : 0.007;
    col[i * 3] = c;
    col[i * 3 + 1] = c;
    col[i * 3 + 2] = c * (isHub ? 1.04 : 1.25);
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.computeVertexNormals();
  _tyreGeos.set(key, g);
  return g;
}

/** Instanced wheels, axles along X. One draw call per leg. Named 'tyres': groundOffsetFor() measures the lowest tyre. */
function tyres(ctx, parent, name, centres, r, width, mat) {
  const geo = tyreGeometry(r, width);
  const mats = centres.map((c) =>
    new THREE.Matrix4().compose(new THREE.Vector3(...c), new THREE.Quaternion(), new THREE.Vector3(1, 1, 1))
  );
  const mesh = addInstanced(ctx.model, parent, name, geo, mat, mats);
  mesh.computeBoundingBox();
  mesh.computeBoundingSphere();
  return mesh;
}

/** The point a fraction `t` of the way along the vector `v`, plus an offset. */
const along3 = (v, t, dx = 0, dy = 0, dz = 0) => [v.x * t + dx, v.y * t + dy, v.z * t + dz];

/**
 * The oleo and its linkage, on a leg whose strut runs from the trunnion (the
 * group's origin) down `rel` to the axle: the outer cylinder over the upper
 * three fifths, a collar at its foot, the torque links — the scissor on the
 * front that keeps the wheels pointing the way the leg does — and a brace.
 * The core's thin strut stays inside as the sliding piston (it animates with
 * the compression). `brace`: 'aft' (a nose leg: up and back into the bay) or
 * a side (+1/-1: a main leg's side stay, inboard towards the fuselage).
 */
function oleo(ctx, leg, rel, { oleo: R, r, mats, brace = 'aft', side = 0 }) {
  const G = mats.gear;
  const len = rel.length();
  ctx.tube('Oleo cylinder', [0, 0.12, 0], along3(rel, 0.6), R, G, leg, 10);
  ctx.tube('Oleo collar', along3(rel, 0.52), along3(rel, 0.62), R * 1.2, G, leg, 10);
  // Torque links: upper arm from the collar, lower arm from above the axle, knee forward.
  const a = along3(rel, 0.62, 0, 0, -R * 0.95);
  const knee = along3(rel, 0.81, 0, 0, -R * 2.7);
  const b = along3(rel, 1.0, 0, r * 0.3, -R * 0.95);
  ctx.tube('Torque link', a, knee, R * 0.3, G, leg, 6);
  ctx.tube('Torque link', knee, b, R * 0.28, G, leg, 6);
  ctx.tube('Torque link pin', along3(rel, 0.81, -R * 0.45, 0, -R * 2.7), along3(rel, 0.81, R * 0.45, 0, -R * 2.7), R * 0.14, G, leg, 6);
  if (brace === 'aft') {
    ctx.tube('Drag brace', [0, 0.02, len * 0.45], along3(rel, 0.6, 0, 0, R * 0.6), R * 0.42, G, leg, 8);
  } else {
    const inboard = -(side || 1);
    ctx.tube('Side stay', [inboard * len * 0.55, 0.02, 0], along3(rel, 0.6, inboard * R * 0.6), R * 0.42, G, leg, 8);
  }
}

/**
 * A bogie: a beam with `axles` pairs of wheels, centred on its own pivot so
 * it can be tilted. Returned group is positioned by the caller.
 */
function bogie(ctx, parent, label, { axles, pitch, track, r, width, mats }) {
  const g = new THREE.Group();
  g.name = label;
  parent.add(g);
  const centres = [];
  const half = ((axles - 1) * pitch) / 2;
  for (let i = 0; i < axles; i++) {
    const z = -half + i * pitch;
    for (const x of [-track / 2, track / 2]) centres.push([x, 0, z]);
  }
  tyres(ctx, g, `${label} tyres`, centres, r, width, mats.tyre);
  ctx.box(`${label} beam`, [r * 0.42, r * 0.4, half * 2 + r * 0.9], [0, r * 0.12, 0], mats.gear, g);
  for (let i = 0; i < axles; i++) {
    ctx.tube(`${label} axle`, [-track / 2 - width * 0.3, 0, -half + i * pitch], [track / 2 + width * 0.3, 0, -half + i * pitch], r * 0.12, mats.gear, g, 8);
  }
  // The brake packs: a drum inside each wheel pair, between the tyres.
  for (let i = 0; i < axles; i++) {
    ctx.tube(`${label} brakes`, [-track / 2 + width * 0.55, 0, -half + i * pitch], [track / 2 - width * 0.55, 0, -half + i * pitch], r * 0.45, mats.hub, g, 10);
  }
  return g;
}

/**
 * Replace the core's single tyre and bare strut on a leg with the real
 * arrangement: the oleo and its linkage (see oleo()), then
 *
 *   dual   two wheels side by side on the axle (A320 mains, every nose leg);
 *          they stay in the core's rolling wheel group, so they still steer
 *          and turn
 *   bogie  a tilting beam of 2 or 3 axle pairs (747 and A380 wing gear)
 *
 * and the doors that stay open with the gear down: a nose leg's two aft
 * doors, hinged at the bay's edges and hanging beside the strut; a main
 * leg's door on the outboard side of the strut. (The forward bay doors of a
 * real airliner close again once the gear is down, so they are painted on
 * the belly by the livery, not drawn.)
 */
function refitLeg(ctx, legId, opt) {
  const leg = ctx.parts[legId];
  if (!leg) return null;
  const mats = opt.mats;
  const wheel = findByName(leg, 'Rolling wheels');
  const axle = findByName(leg, 'Suspending axle');
  const steering = findByName(leg, 'Wheel steering');
  const old = wheel && wheel.children.find((c) => c.name === 'Tyres and hubs');
  if (old) old.removeFromParent();
  const rel = steering ? steering.position : new THREE.Vector3(0, -1, 0);
  const len = rel.length();
  const side = Math.sign(leg.position.x) || 0;
  oleo(ctx, leg, rel, { oleo: opt.oleo, r: opt.r, mats, brace: side ? 'side' : 'aft', side });
  if (opt.kind === 'dual') {
    // The axle through both wheels turns with the steering but not with the wheels.
    if (steering) ctx.tube('Axle', [-opt.track / 2 - opt.width * 0.3, 0, 0], [opt.track / 2 + opt.width * 0.3, 0, 0], opt.r * 0.13, mats.gear, steering, 8);
    tyres(ctx, wheel, 'Twin tyres', [[-opt.track / 2, 0, 0], [opt.track / 2, 0, 0]], opt.r, opt.width, mats.tyre);
  }
  if (!side) {
    // Nose gear: two aft doors, hinged at the bay edges, hanging either side
    // of the strut and canted out a little.
    const h = len * 0.46;
    for (const s of [-1, 1]) {
      const door = ctx.box('Nose gear door', [0.03, h, opt.track * 0.95], [s * (opt.oleo * 1.3 + 0.06), -h / 2 - 0.02, 0.1], mats.nacelle, leg);
      door.rotation.z = s * 0.07;
      door.castShadow = true;
    }
  } else {
    // Main gear: the leg door on the outboard side of the strut.
    const h = len * 0.72;
    const door = ctx.box('Gear leg door', [0.035, h, Math.max(opt.r * 2.6, (opt.pitch || 0) * 0.9)], [side * (opt.oleo * 1.5 + 0.1), -h / 2 - 0.02, 0], mats.nacelle, leg);
    door.castShadow = true;
  }
  if (opt.kind === 'dual') return null;
  const b = bogie(ctx, axle, `${legId} bogie`, opt);
  b.position.copy(rel);
  return b;
}

/**
 * A body-gear leg the core does not know about (747: four wheels, A380: six),
 * with its own retraction — forwards into the belly, as the real ones go.
 */
function bodyLeg(ctx, side, { x, z, attachY, contactY, axles, pitch, track, r, width, oleo: R, mass, mats }) {
  const id = side < 0 ? 'leftBodyGear' : 'rightBodyGear';
  const g = ctx.group(id, side < 0 ? 'Port body landing gear' : 'Starboard body landing gear', mass, 'fuselage', ctx.parts.fuselage);
  g.position.set(side * x, attachY, z);
  const drop = contactY + r - attachY; // negative: from the attach down to the axle
  const rel = new THREE.Vector3(0, drop, 0);
  // The piston, the full length (the core draws this for its own legs).
  ctx.tube('Body gear piston', [0, 0, 0], [0, drop, 0], R * 0.62, mats.gear, g, 8);
  oleo(ctx, g, rel, { oleo: R, r, mats, brace: 'aft' });
  const b = bogie(ctx, g, `${id} bogie`, { axles, pitch, track, r, width, mats });
  b.position.set(0, drop, 0);
  return { leg: g, bogie: b };
}

/**
 * Bogies that stay flat on the runway.
 *
 * The flight model pivots the aeroplane about one pair of main contact points
 * (AIRLINER_GEOMETRY main.z). A 747 has four legs spread over three and a half
 * metres; drawn rigid, the aft wheels would sink 0.3-0.6 m into the tarmac at
 * rotation. So on the ground each bogie counter-rotates to stay level and any
 * bogie aft of the pivot rides up by exactly what the pitch would have buried
 * it — the oleo compressing, which is what the real one does. In the air they
 * trail nose-up a few degrees, so the rear wheels touch first.
 */
function levelBogies(ctx, bogies, pivotZ) {
  if (!bogies.length) return;
  const q = new THREE.Quaternion();
  const rest = bogies.map((b) => ({ node: b.node, z: b.z, y: b.node.position.y }));
  let tilt = 0;
  let lift = 0;
  ctx.registerAnimation((dt, state) => {
    ctx.model.getWorldQuaternion(q);
    // Nose-up pitch of the airframe, from the forward axis.
    const pitch = Math.asin(clamp(2 * (q.w * q.x - q.y * q.z), -1, 1));
    const onGround = !!state.onGround;
    /*
     * Trailing only when it is really flying. The build pass, the hangar and
     * any parked copy call this with no ground flag at all, and a trailed
     * bogie hangs its rear wheels 0.1-0.2 m below the others — which is what
     * groundOffsetFor() then measured, lifting the whole 747 off the tarmac
     * by 0.17 m and the A380 by 0.29.
     */
    const v = state.worldVelocity;
    const flying = state.onGround === false && !!v && Math.hypot(v.x || 0, v.y || 0, v.z || 0) > 20;
    const wantTilt = onGround ? -pitch : flying ? 0.14 : 0;
    const k = 1 - Math.exp(-(dt || 0) * 10);
    tilt = dt > 0 ? mix(tilt, wantTilt, k) : wantTilt;
    const wantLift = onGround ? Math.sin(Math.max(0, pitch)) : 0;
    lift = dt > 0 ? mix(lift, wantLift, k) : wantLift;
    for (const b of rest) {
      b.node.rotation.x = tilt;
      b.node.position.y = b.y + Math.max(0, b.z - pivotZ) * lift;
    }
  });
}

/* ------------------------------------------------------------------ *
 * Windows, doors, glazing.
 * ------------------------------------------------------------------ */

/**
 * The trailing edge of an airliner wing is cranked: unswept inboard of the
 * engines, swept outboard. The core lofts a straight taper, so the inboard
 * trailing edge is filled in here — without it the wing looks like a
 * fighter's from above.
 */
function trailingEdgeFill(ctx, kinkX, extra, thickness) {
  const w = ctx.config.wing;
  const root = wingAt(w, w.rootX);
  const kink = wingAt(w, kinkX);
  for (const side of [-1, 1]) {
    const parent = ctx.parts[side < 0 ? 'leftWing' : 'rightWing'];
    plate(ctx, 'Inboard trailing edge', [
      [side * w.rootX, root.mid, root.te - 0.3],
      [side * w.rootX, root.mid, root.te + extra],
      [side * kinkX, kink.mid, kink.te + 0.15],
      [side * kinkX, kink.mid, kink.te - 0.3],
    ], thickness, ctx.materials.wing, parent);
  }
}

/**
 * The fin in livery colour: an overlay a shade proud of the core's fin.
 * `mat` must be a decal material (polygon offset, see airliner-kit DECAL):
 * dress() makes one, since the shell and the fin are millimetres apart.
 */
function paintFin(ctx, mat, from = 0.1) {
  const fc = ctx.config.fin;
  const fin = ctx.parts.verticalFin;
  if (!fc || !fin) return;
  const geo = new THREE.BoxGeometry(1, 1, 1, 1, 2, 1);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const t = from + (p.getY(i) + 0.5) * (1 - from);
    const ch = mix(fc.rootChord, fc.tipChord, t);
    const th = mix(fc.thickness || 0.14, 0.045, t);
    p.setXYZ(i, p.getX(i) * th * 1.14 + Math.sign(p.getX(i)) * 0.004,
      fc.rootY + fc.height * t + (t > 0.999 ? 0.01 : 0),
      fc.rootZ + fc.sweep * t + (0.012 + (p.getZ(i) + 0.5) * 0.735) * ch);
  }
  geo.computeVertexNormals();
  meshOf(ctx, 'Painted fin', geo, mat, fin);
  // And the rudder, which is its own hinged group in the core: painted in the
  // rudder's own frame so it swings with it.
  const rudder = findByName(fin, 'Rudder');
  if (!rudder) return;
  const piv = rudder.position;
  const rg = new THREE.BoxGeometry(1, 1, 1, 1, 2, 1);
  const q = rg.attributes.position;
  for (let i = 0; i < q.count; i++) {
    const t = from + (q.getY(i) + 0.5) * (1 - from);
    const ch = mix(fc.rootChord, fc.tipChord, t);
    q.setXYZ(i, (fc.x || 0) + q.getX(i) * mix(0.1, 0.025, t) * 1.3 + Math.sign(q.getX(i)) * 0.004 - piv.x,
      fc.rootY + fc.height * t - piv.y,
      fc.rootZ + fc.sweep * t + (0.775 + (q.getZ(i) + 0.5) * 0.215) * ch - piv.z);
  }
  rg.computeVertexNormals();
  meshOf(ctx, 'Painted rudder', rg, mat, rudder);
}


/** The pylon: from the top of the fan cowl up into the wing's leading edge. */
function pylon(ctx, e, mat) {
  const w = ctx.config.wing;
  const g = ctx.parts[e.id];
  if (!g) return;
  const r = e.radius;
  const L = e.length;
  const zf = e.z - L / 2;
  const zb = e.z + L / 2;
  const wa = wingAt(w, e.x);
  const topY = e.y + r * 0.93;
  plate(ctx, 'Engine pylon', [
    [e.x, topY - 0.12, zf + L * 0.3],
    [e.x, e.y + r * 0.5, zb + L * 0.32],
    [e.x, wa.mid, wa.le + wa.chord * 0.55],
    [e.x, wa.under + 0.05, wa.le - 0.25],
  ], r * 0.3, mat, g);
}

/** The APU exhaust at the very tip of the tail cone. */
function apu(ctx, last) {
  const tube = new THREE.CylinderGeometry(last.w * 1.6, last.w * 2.2, 0.5, 10, 1, true);
  tube.rotateX(Math.PI / 2);
  tube.translate(0, last.yc, last.z - 0.2);
  meshOf(ctx, 'APU exhaust', tube, ctx.materials.dark, ctx.parts.tail);
}

/** A belly fairing where the wing meets the body, painted the belly's colour. */
function bellyFairing(ctx, list, along, mat) {
  const stations = list.map(ell);
  const a = stations[0];
  stations.unshift({ z: a.z - 0.7, w: 0.02, top: a.yc + 0.02, bot: a.yc - 0.02, yc: a.yc });
  const h = hull({ stations, radial: 8, maxStep: 2.5, closeTail: true });
  const p = h.geometry.attributes.position;
  const uv = h.geometry.attributes.uv;
  for (let i = 0; i < p.count; i++) uv.setXY(i, along(p.getZ(i)), 0.03);
  meshOf(ctx, 'Wing-body fairing', h.geometry, mat, ctx.parts.fuselage);
}

/** Ellipse station [z, rx, ry, cy] (the pack's) as a hull station. */
function ell([z, rx, ry, cy]) {
  return { z, w: rx, top: cy + ry, bot: cy - ry, yc: cy, nT: 2, nB: 2 };
}
/** A hull station: top and bottom of the skin on the centreline, half-width, shoulder height, exponents. */
function st(z, top, bot, w, yc, nT = 2, nB = 2) {
  return { z, w, top, bot, yc: yc ?? (top + bot) / 2, nT, nB };
}
/** The pack core's own station list, from the hull's: [z, rx, ry, cy]. */
function bodyOf(stations) {
  return stations.map((s) => [s.z, Math.max(0.001, s.w), Math.max(0.001, (s.top - s.bot) / 2), (s.top + s.bot) / 2]);
}
/** Ring stations every `step` between a and b, for the curving tail cone. */
function ringsBetween(a, b, step) {
  const out = [];
  for (let z = a + step; z < b - step * 0.4; z += step) out.push(+z.toFixed(3));
  return out;
}

/**
 * Everything in the redo that every airliner has: fuselage and livery,
 * flight deck, windows, doors, engines, registration, fairing, fin paint.
 */
function dress(ctx, S) {
  const { parts, model, config: c } = ctx;
  const scheme = c.scheme && typeof c.scheme === 'object' ? c.scheme : null;
  // A named airline scheme brings its own cheatline, tail and number; the
  // house colours are the type's own, as they always were.
  const named = !!(scheme && scheme.id && scheme.id !== 'house');
  const base = c.paint;
  const accent = c.accent;
  const line = named && typeof scheme.cheatline === 'string' ? scheme.cheatline : null;
  const tailColour = named && scheme.tail != null ? scheme.tail : null;
  const reg = (named && scheme.reg) || (scheme && scheme.reg) || c.registration;
  // The airline's layout (aircraft/liveries.js `style`): belly and cowl
  // colours, the cheatline's bands, bare metal, the name's weight.
  const style = named && scheme.style && typeof scheme.style === 'object' ? scheme.style : null;
  const F = S.fuselage;
  const along = piecewise(F.alongKnots);
  const h = loftFuselage({ ...F, along });
  const HUMP = 0.88; // the hump is painted from the roof band of the texture, hidden under it on the main loft
  const hump = S.hump ? loftFuselage({ ...S.hump, along, cuts: [F.cuts[0]] }, { vMap: (v) => HUMP + (1 - HUMP) * v }) : null;
  const vMain = (z, y) => 1 - h.angleAt(z, y) / Math.PI;
  const vHump = hump ? (z, y) => HUMP + (1 - HUMP) * (1 - hump.angleAt(z, y) / Math.PI) : null;
  const first = F.stations[0];
  const last = F.stations[F.stations.length - 1];
  // One side's doors paint both: the texture is the same either side.
  const painted = [];
  for (const d of S.doors) {
    if (painted.some((p) => Math.abs(p.z - d.z) < 0.01 && p.deck === d.deck)) continue;
    painted.push({ ...d, vAt: d.deck === 'upper' && hump ? vHump : undefined });
  }
  // The nose gear bay's doors on the belly, drawn shut round the leg.
  const ng = c.gear && c.gear.nose;
  const bays = ng ? [{ z0: ng[2] - 1.6 * (c.gear.noseRadius || 0.4) - 0.3, z1: ng[2] + 2.4 * (c.gear.noseRadius || 0.4), halfWidth: 1.5 * (c.gear.noseRadius || 0.4), w: h.section(ng[2]).w }] : [];
  const tex = liveryTexture({
    key: c.id, base, accent, line, along, vAt: vMain, cabinZ: S.cabinZ, bellyY: S.bellyY, z0: first.z, z1: last.z,
    laps: S.laps, cheat: S.cheat, doors: painted, radomeZ: S.radomeZ, bays, style,
  });
  const M = airlinerMaterials(model, { livery: tex, base, style });
  placeFuselage(ctx, h, F.cuts, M.skin);
  if (hump) {
    const [front, back] = splitByZ(hump.geometry, [F.cuts[0]]);
    if (front) meshOf(ctx, 'Upper deck nose skin', front, M.skin, parts.nose);
    if (back) meshOf(ctx, 'Upper deck skin', back, M.skin, parts.fuselage);
  }
  bellyFairing(ctx, S.fairing, along, M.skin);
  apu(ctx, last);

  // The flight deck. The frames and glass sit 3 and 4 cm out: the hull is
  // flat quads between its vertices, and on these tubes the skin between two
  // of them sags up to 1.5 cm below the surface the panes follow (see
  // airliner-kit windowRows), so anything laid closer is half buried.
  const deck = S.flightDeckOn === 'upper' ? hump : h;
  const gz = glazing(deck, S.panes, { frame: S.frame ?? 0.065, frameOff: 0.03, glassOff: 0.042 });
  meshOf(ctx, 'Windscreen frames', gz.frames, M.frame, parts.nose).castShadow = false;
  meshOf(ctx, 'Flight deck glass', gz.glass, M.glass, parts.nose).castShadow = false;
  if (gz.wipers) meshOf(ctx, 'Windscreen wipers', gz.wipers, M.wiper, parts.nose);

  // Which breakaway piece of the fuselage a station z is on: the skin is cut
  // at F.cuts (placeFuselage), and everything that sits on the skin — the
  // windows, the doors, the decals, the aerials — must hang from the piece it
  // sits on, or it stays behind in the air when that piece comes off.
  const cuts = F.cuts;
  const pieceOf = (z) => (z < cuts[0] ? parts.nose : z > cuts[1] ? parts.tail : parts.fuselage);

  // Cabin windows, every deck: one draw per piece that has any (the 747's
  // upper deck runs forward into the nose piece, every type's main deck runs
  // aft past the tail cut).
  windowRows(ctx, S.windows.map((r) => ({ ...r, h: r.deck === 'upper' ? hump : h })), M.window, pieceOf);

  // Doors that open.
  const doors = buildDoors({
    list: S.doors.map((d) => ({ ...d, hull: d.deck === 'upper' && hump ? hump : h })),
    parentFor: (d) => pieceOf(d.z),
    materials: M,
    uvOf: (hh, z, s) => [along(z), hh === hump ? HUMP + (1 - HUMP) * (1 - s / Math.PI) : 1 - s / Math.PI],
    own: (g) => model.userData.ownGeometry(g),
  });
  ctx.registerAnimation((dt) => doors.update(dt));
  ctx.exports.doors = doors;
  // The hull and the panes in its own (z, s) go with the outline, so the
  // flight deck inside can be cut on exactly these lines (cockpit/flightdeck.js).
  // (The hull is not enumerable: a model's userData is JSON-copied when it
  // is cloned, and the hull carries its whole geometry.)
  ctx.exports.flightDeck = { panes: gz.outlines, eye: [...c.eye], on: S.flightDeckOn === 'upper' ? 'upper deck' : 'nose', quads: gz.quads, unit: 1 };
  Object.defineProperty(ctx.exports.flightDeck, 'hull', { value: deck, enumerable: false });
  // The fuselage as one thing, for whoever measures the aeroplane (the
  // ground crew's jobs): its skin is three pieces, so its longest mesh is
  // only the cabin.
  const tops = [...F.stations, ...(S.hump ? S.hump.stations : [])];
  ctx.exports.fuselage = {
    nose: first.z,
    tail: last.z,
    halfWidth: Math.max(...F.stations.map((q) => q.w)),
    top: Math.max(...tops.map((q) => q.top)),
    bottom: Math.min(...F.stations.map((q) => q.bot)),
  };

  // Turbofans and their pylons.
  for (const e of c.engines) {
    const g = parts[e.id];
    if (!g) continue;
    turbofan(ctx, g, e, M);
    pylon(ctx, e, M.nacelle);
  }

  // The number, on the tail cone.
  const light = (() => {
    const k = new THREE.Color(base);
    return 0.2126 * k.r + 0.7152 * k.g + 0.0722 * k.b > 0.35;
  })();
  if (reg) {
    // A registration is lettered in a plain medium-weight sans, spaced out,
    // as the real ones are stencilled.
    const tex2 = aircraftDecalTexture(reg, { color: light ? '#1f272e' : '#e9eef2', background: 'transparent', width: 512, height: 128, weight: 600, spacing: 0.08 });
    registration(ctx, h, { text: reg, z: S.reg.z, y: S.reg.y, width: S.reg.w, texture: tex2 }, pieceOf(S.reg.z));
  }
  // The titling line a scheme may carry — "UNITED STATES OF AMERICA" on Air
  // Force One (aircraft/liveries.js), the only one that has ever asked for
  // one. The pack's old skin (render/textures.js airframeTexture) painted it
  // into the texture; here it is a decal in the band above the windows, from
  // behind the forward door back towards the wing (S.title), in the scheme's
  // cheatline colour, and registration() flips it per side so it reads
  // left-to-right from both. Sixteen to one: the decal texture fits twenty
  // or so characters at about two thirds of its width.
  // ...and now every airline's name (aircraft/liveries.js `titling`), as the
  // real ones wear it: the airliner models read `titling`, nothing else does,
  // so a Skylark in Abyssinia colours stays a plain flying-school aeroplane.
  const words = named ? [scheme.title, scheme.titling].find((w) => typeof w === 'string' && w.trim()) : null;
  const title = words ? words.trim() : null;
  if (title && S.title) {
    // The name in the airline's own ink and weight (style.titleInk,
    // titleWeight, titleSpacing), else the cheatline colour; a 'billboard'
    // layout sets it taller (ten to one rather than sixteen), as a freight
    // or low-cost airline does.
    const ink = (style && style.titleInk) || (typeof line === 'string' ? line : light ? '#1f272e' : '#e9eef2');
    const billboard = !!(style && style.layout === 'billboard');
    const ratio = billboard ? 10 : 16;
    const tex3 = aircraftDecalTexture(title, {
      color: ink, background: 'transparent', width: 128 * ratio, height: 128,
      weight: (style && style.titleWeight) || 700, spacing: style && typeof style.titleSpacing === 'number' ? style.titleSpacing : 0.04,
    });
    const tz = S.title.z;
    registration(ctx, h, { text: title, z: tz, y: S.title.y, width: S.title.w, height: S.title.w / ratio, texture: tex3, name: 'Titling' }, pieceOf(tz));
  }

  // The fin in the scheme's tail colour, or the accent. Its own material
  // either way: the paint is a shell a few millimetres proud of the core's
  // fin (paintFin), and at the tip the two are closer than the depth buffer
  // can tell apart from a few hundred metres — so, like every other overlay
  // on these aeroplanes, it carries the decal polygon offset and the paint
  // wins the depth test on every frame rather than flickering with the fin.
  const finMat = model.userData.ownMaterial(Object.assign(ctx.materials.accent.clone(), DECAL));
  if (tailColour != null) {
    finMat.color = new THREE.Color(tailColour);
    finMat.name = 'Aircraft_livery_tail';
  }
  paintFin(ctx, finMat);
  // The airline's mark on the fin (aircraft/liveries.js `emblem`): a
  // geometric device of the game's own, in the body colour on the tail
  // colour, one each side, where every real airline puts its own.
  if (named && scheme.emblem) {
    const inks = Array.isArray(style && style.emblemInks) && style.emblemInks.length ? style.emblemInks : [base];
    finEmblem(ctx, scheme.emblem, { inks, tail: tailColour != null ? tailColour : accent });
  }
  // Flap-track fairings: the canoes under the trailing edge every airliner
  // wing carries (not a turboprop's hinged flaps, not Concorde's delta).
  if (S.flapTracks !== false) flapTrackFairings(ctx, M.nacelle);

  // Antennas: blade aerials on the crown and under the belly, and the pitot
  // probes either side of the nose below the flight deck.
  const k = clamp(F.stations.reduce((m, q) => Math.max(m, q.w), 0) / 2, 0.9, 1.9); // 1 on the A320, 1.8 on the A380
  const blade = (z, y, up, mat, parent) => plate(ctx, up > 0 ? 'VHF aerial' : 'Belly aerial', [
    [0, y - 0.02 * up, z], [0, y + 0.34 * k * up, z + 0.1 * k], [0, y + 0.34 * k * up, z + 0.26 * k], [0, y - 0.02 * up, z + 0.42 * k],
  ], 0.04 * k, mat, parent);
  const crownAt = (z) => (hump && z > S.hump.stations[0].z && z < S.hump.stations[S.hump.stations.length - 1].z ? hump.topAt(z) : h.topAt(z));
  for (const z of S.aerials.crown) blade(z, crownAt(z), 1, M.nacelle, pieceOf(z));
  for (const z of S.aerials.belly) blade(z, h.botAt(z), -1, M.core, pieceOf(z));
  for (const side of [-1, 1]) {
    const z = S.radomeZ + 0.9 * k;
    const y = c.eye[1] - 1.0 * k;
    const x = h.halfWidthAt(z, y);
    ctx.tube('Pitot probe', [side * (x - 0.02), y, z], [side * (x + 0.05 * k), y - 0.01, z - 0.42 * k], 0.028 * k, M.gear, parts.nose, 5);
  }

  // Where the game hangs its lamps (model-adapter addLights): the real wing
  // tips, which on these swept wings are 8-20 m aft of its guess, the beacon
  // on the crown over the wing, the tail light on the end of the cone and
  // the landing lights in the wing roots.
  const w = c.wing;
  const tipX = w.rootX + w.span;
  const tip = wingAt(w, tipX);
  const rootLamp = wingAt(w, w.rootX + 1.6 * k);
  const beaconZ = S.beaconZ ?? S.cabinZ;
  ctx.exports.lamps = {
    navLeft: [-tipX, tip.mid + 0.04, tip.le + 0.12],
    navRight: [tipX, tip.mid + 0.04, tip.le + 0.12],
    strobeL: [-tipX, tip.mid, tip.te - 0.15],
    strobeR: [tipX, tip.mid, tip.te - 0.15],
    tail: [0, last.yc + 0.04, last.z - 0.15],
    beacon: [0, crownAt(beaconZ) + 0.1, beaconZ],
    landing: [-(w.rootX + 1.6 * k), rootLamp.mid - 0.04, rootLamp.le + 0.12],
  };
  return { h, hump, M };
}

/* ------------------------------------------------------------------ *
 * The aeroplanes.
 * ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ *
 * The airline's mark on the fin, and the flap-track fairings
 * ------------------------------------------------------------------ */

const emblems = new Map();
/**
 * A fin emblem, drawn once per style, inks and tier: 'stripes' (three
 * slanted bars, each in its own ink when three are given), 'compass' (a
 * ring round a four-point rose), 'star' (eight points), 'wave' (a swept
 * band over a thinner one, the second ink for the thin one), 'sun' (a disc
 * with short rays, the second ink for the rays), 'moon' (a crescent and a
 * dot). Geometric and original: no real airline's logo is drawn or copied.
 * ('globe' is kept as a name for the compass: the saved id of an older
 * scheme, and a circle with meridians was too near a real mark.)
 */
function emblemTexture(style, inks) {
  const tier = textureTier();
  const key = `airliner-emblem|${style}|${inks.join(',')}|${tier}`;
  if (emblems.has(key)) return emblems.get(key);
  const S = tier === 'high' || tier === 'ultra' ? 512 : 256;
  const c = document.createElement('canvas');
  c.width = S;
  c.height = S;
  const g = c.getContext('2d');
  const ink = inks[0];
  const inkAt = (i) => inks[Math.min(i, inks.length - 1)];
  if (g && typeof g.clearRect === 'function') {
    g.clearRect(0, 0, S, S);
    g.fillStyle = ink;
    g.strokeStyle = ink;
    g.lineCap = 'round';
    g.lineJoin = 'round';
    const cx = S / 2;
    const cy = S / 2;
    if (style === 'stripes') {
      g.lineWidth = S * 0.11;
      for (let i = -1; i <= 1; i++) {
        g.strokeStyle = inks.length >= 3 ? inkAt(i + 1) : ink;
        g.beginPath();
        g.moveTo(cx + i * S * 0.2 - S * 0.14, cy + S * 0.3);
        g.lineTo(cx + i * S * 0.2 + S * 0.14, cy - S * 0.3);
        g.stroke();
      }
    } else if (style === 'compass' || style === 'globe') {
      // A compass rose: a ring, four long points and four short between.
      g.lineWidth = S * 0.055;
      g.beginPath();
      g.arc(cx, cy, S * 0.4, 0, Math.PI * 2);
      g.stroke();
      g.beginPath();
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2 - Math.PI / 2;
        const d = i % 2 ? S * 0.1 : S * 0.33;
        g.lineTo(cx + Math.cos(a) * d, cy + Math.sin(a) * d);
      }
      g.closePath();
      g.fill();
      g.fillStyle = inkAt(1);
      g.beginPath();
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2 - Math.PI / 4;
        const d = i % 2 ? S * 0.06 : S * 0.2;
        g.lineTo(cx + Math.cos(a) * d, cy + Math.sin(a) * d);
      }
      g.closePath();
      g.fill();
    } else if (style === 'star') {
      g.beginPath();
      const R = S * 0.4;
      const r = S * 0.12;
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2 - Math.PI / 2;
        const d = i % 2 ? r : R;
        g.lineTo(cx + Math.cos(a) * d, cy + Math.sin(a) * d);
      }
      g.closePath();
      g.fill();
    } else if (style === 'wave') {
      g.lineWidth = S * 0.12;
      g.beginPath();
      g.moveTo(S * 0.1, cy + S * 0.18);
      g.bezierCurveTo(S * 0.35, cy - S * 0.35, S * 0.6, cy + S * 0.4, S * 0.9, cy - S * 0.2);
      g.stroke();
      g.strokeStyle = inkAt(1);
      g.lineWidth = S * 0.06;
      g.beginPath();
      g.moveTo(S * 0.18, cy + S * 0.36);
      g.bezierCurveTo(S * 0.42, cy - S * 0.12, S * 0.62, cy + S * 0.5, S * 0.84, cy + S * 0.06);
      g.stroke();
    } else if (style === 'sun') {
      g.beginPath();
      g.arc(cx, cy, S * 0.2, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = inkAt(1);
      g.lineWidth = S * 0.06;
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        g.beginPath();
        g.moveTo(cx + Math.cos(a) * S * 0.27, cy + Math.sin(a) * S * 0.27);
        g.lineTo(cx + Math.cos(a) * S * 0.4, cy + Math.sin(a) * S * 0.4);
        g.stroke();
      }
    } else {
      // moon
      g.beginPath();
      g.arc(cx, cy, S * 0.36, 0, Math.PI * 2);
      g.fill();
      g.globalCompositeOperation = 'destination-out';
      g.beginPath();
      g.arc(cx + S * 0.16, cy - S * 0.08, S * 0.3, 0, Math.PI * 2);
      g.fill();
      g.globalCompositeOperation = 'source-over';
      g.beginPath();
      g.arc(cx + S * 0.24, cy - S * 0.22, S * 0.06, 0, Math.PI * 2);
      g.fill();
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  t.name = key;
  emblems.set(key, t);
  return t;
}

/**
 * The emblem on both sides of the (single, centred) fin: a quad bent to
 * the fin's taper from half to 85% of its height, over the forward part of
 * the chord ahead of the rudder, 3 cm proud of the painted shell with a
 * deeper decal offset than the paint's, so it wins the depth test over it.
 */
function finEmblem(ctx, style, { ink, inks }) {
  const fc = ctx.config.fin;
  const fin = ctx.parts.verticalFin;
  if (!fc || !fin || fc.mirror || fc.x) return null;
  const list = Array.isArray(inks) && inks.length ? inks : [ink];
  const tex = emblemTexture(style, list.map((c) => css(c)));
  const mat = ctx.model.userData.ownMaterial(new THREE.MeshBasicMaterial({
    name: 'Airliner_fin_emblem', map: tex, transparent: true, depthWrite: false, toneMapped: true,
    polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
  }));
  const t0 = 0.5;
  const t1 = 0.85;
  const chordAt = (t) => mix(fc.rootChord, fc.tipChord, t);
  const size = Math.min(fc.height * (t1 - t0), chordAt((t0 + t1) / 2) * 0.5);
  const tMid = (t0 + t1) / 2;
  const tHalf = size / fc.height / 2;
  for (const side of [1, -1]) {
    const geo = new THREE.PlaneGeometry(1, 1, 1, 3);
    const p = geo.attributes.position;
    const uv = geo.attributes.uv;
    for (let i = 0; i < p.count; i++) {
      const u = p.getX(i) + 0.5; // 0 forward .. 1 aft (the emblem reads the same from both sides)
      const t = tMid + p.getY(i) * tHalf * 2;
      const ch = chordAt(t);
      const th = mix(fc.thickness || 0.14, 0.045, t);
      const le = fc.rootZ + fc.sweep * t;
      const zc = le + ch * 0.42;
      p.setXYZ(i, side * (th * 0.57 + 0.034), fc.rootY + fc.height * t, zc + (u - 0.5) * size);
      uv.setXY(i, side > 0 ? u : 1 - u, uv.getY(i));
    }
    geo.computeVertexNormals();
    const m = meshOf(ctx, 'Tail emblem', geo, mat, fin);
    m.castShadow = false;
  }
  return mat;
}

/** css colour string of anything THREE.Color takes (the kit's, repeated: it is not exported). */
function css(c) {
  try {
    return '#' + new THREE.Color(c).getHexString();
  } catch (e) {
    return '#f4f6f8';
  }
}

/**
 * Flap-track fairings: the canoes under the trailing edge that carry the
 * flap tracks, two a side on a narrow-body and three on a wide-body, each
 * a lathe along the chord hanging from the underside and running past the
 * trailing edge. Sized from the local chord, as the real ones scale.
 */
function flapTrackFairings(ctx, mat) {
  const w = ctx.config.wing;
  if (!w || w.flaps === false) return;
  const span2 = 2 * (w.rootX + w.span);
  const at = span2 > 45 ? [0.3, 0.5, 0.68] : [0.33, 0.6];
  for (const side of [-1, 1]) {
    const parent = ctx.parts[side < 0 ? 'leftWing' : 'rightWing'];
    if (!parent) continue;
    for (const f of at) {
      const x = w.rootX + w.span * f;
      const wa = wingAt(w, x);
      const L = wa.chord * 0.5;
      const d = Math.max(0.3, Math.min(1.1, wa.chord * 0.1));
      const z0 = wa.te - L * 0.68;
      const geo = turned([[0.02 * d, z0], [0.5 * d, z0 + 0.3 * L], [0.5 * d, z0 + 0.6 * L], [0.15 * d, z0 + L], [0.001, z0 + L + 0.02]], 10, { vBand: 0.5 });
      geo.translate(side * x, wa.under - 0.22 * d, 0);
      meshOf(ctx, 'Flap track fairing', geo, mat, parent);
    }
  }
}

const A = GEO.a320;
const B = GEO.b747;
const C = GEO.a380;

/** Axle height: the contact point plus a tyre radius. */
const axleY = (g, r) => g.ground + r;

/** Both sides of a door list. */
const both = (list) => list.flatMap((d) => [
  { ...d, id: d.id.replace('#', 'L'), side: 'left' },
  { ...d, id: d.id.replace('#', 'R'), side: 'right' },
]);

/* ---------------------------------------------------------------- *
 * A320. The nose: the radome a blunt rounded cone with its tip low, a
 * near-flat top running back to the windscreen, then the break — the
 * windscreen leans back at about fifty degrees — and a long brow rounding
 * over to the crown two metres behind it. Six panes: two windscreens
 * either side of a centre post, the sliding window, the small rear one, in
 * a black frame, and nothing above them.
 * ---------------------------------------------------------------- */
const A320 = {
  fuselage: {
    stations: [
      st(-16.80, -0.45, -0.45, 0.0, -0.45),
      st(-16.76, -0.22, -0.66, 0.24, -0.44),
      st(-16.66, -0.06, -0.83, 0.46, -0.45),
      st(-16.45, 0.06, -1.06, 0.74, -0.48),
      st(-16.10, 0.15, -1.33, 1.04, -0.52),
      st(-15.60, 0.22, -1.58, 1.33, -0.56),
      st(-15.00, 0.27, -1.78, 1.57, -0.58, 2.05),
      st(-14.60, 0.32, -1.88, 1.69, -0.58, 2.1),
      st(-14.30, 0.62, -1.94, 1.77, -0.55, 2.15),
      st(-14.00, 0.98, -1.99, 1.83, -0.5, 2.2),
      st(-13.60, 1.27, -2.03, 1.88, -0.42, 2.2),
      st(-13.10, 1.55, -2.05, 1.92, -0.32, 2.15),
      st(-12.40, 1.83, -2.065, 1.95, -0.18, 2.1),
      st(-11.60, 2.0, -2.07, 1.97, -0.06, 2.05),
      st(-10.60, 2.07, -2.07, 1.975, 0),
      st(5.5, 2.07, -2.07, 1.975, 0),
      ell([9.0, 1.9, 1.93, 0.14]),
      ell([12.5, 1.62, 1.55, 0.42]),
      ell([16.0, 1.12, 1.0, 0.78]),
      ell([18.8, 0.62, 0.52, 1.02]),
      ell([20.2, 0.3, 0.28, 1.12]),
      ell([20.77, 0.1, 0.1, 1.15]),
    ],
    radial: 16,
    rings: ringsBetween(5.5, 20.77, 1.5),
    cuts: [-10.6, 9.0],
    alongKnots: [[-16.8, 0], [-10.6, 0.18], [20.77, 1]],
  },
  cabinZ: 0,
  bellyY: -1.2,
  laps: [1.45, -0.8],
  radomeZ: -14.72,
  cheat: { y0: -0.1, y1: 0.15, z0: -12.9, z1: 15.6 },
  reg: { z: 14.4, y: 0.95, w: 2.0 },
  // The titling band (schemes with words): above the window row, from
  // behind door 1 to over the wing.
  title: { z: -3.3, y: 1.15, w: 16 },
  frame: 0.065,
  panes: [
    { name: 'Windscreen', wiper: true, corners: [{ z: -14.56, x: 0.07 }, { z: -14.4, y: 0.37 }, { z: -13.99, y: 0.88 }, { z: -14.06, x: 0.07 }] },
    { name: 'Sliding window', corners: [{ z: -14.3, y: 0.37 }, { z: -13.42, y: 0.4 }, { z: -13.46, y: 0.95 }, { z: -13.9, y: 0.9 }] },
    { name: 'Rear side window', corners: [{ z: -13.32, y: 0.41 }, { z: -12.8, y: 0.43 }, { z: -12.96, y: 0.86 }, { z: -13.32, y: 0.94 }] },
  ],
  windows: [{ y: 0.4, z0: -10.3, z1: 11.4, pitch: 0.533, w: 0.235, ht: 0.33 }],
  doors: both([
    { id: '#1', z: -11.95, y: 0.31, w: 0.81, h: 1.85, kind: 'passenger', sill: -0.62 },
    { id: '#2', z: 12.3, y: 0.31, w: 0.81, h: 1.85, kind: 'passenger', sill: -0.62 },
    // Two Type III exits over the wing, each round a window of the row.
    { id: 'O#1', z: -1.08, y: 0.36, w: 0.51, h: 0.94, kind: 'overwing', sill: -0.11 },
    { id: 'O#2', z: -0.535, y: 0.36, w: 0.51, h: 0.94, kind: 'overwing', sill: -0.11 },
  ]),
  fairing: [
    [-5.6, 1.2, 0.3, -1.75], [-3.6, 1.8, 0.62, -1.6], [-0.5, 1.98, 0.72, -1.52],
    [2.4, 1.95, 0.68, -1.55], [4.6, 1.45, 0.38, -1.72], [5.6, 0.9, 0.2, -1.8],
  ],
  // Belly aerials ahead of the wing: anything under the tail cone would be
  // the first thing to touch the runway at rotation (the strike test).
  aerials: { crown: [-7.0, 3.0], belly: [-9.6, -7.4] },
  beaconZ: -2.0,
};

const a320 = {
  id: 'a320', name: 'Airbus A320', kind: 'airliner', massKg: 18000,
  paint: '#f5f7f9', accent: '#c4122f', registration: 'N320IF', bodySegments: 8,
  body: bodyOf(A320.fuselage.stations),
  wing: {
    rootX: 1.35, span: A.tip.x - 1.35, rootZ: -3.72, rootY: -1.45,
    rootChord: 4.82, tipChord: 1.45, sweep: 8.0, dihedral: A.tip.y + 1.45,
    thickness: 0.62, tipThickness: 0.16, flaps: true, struts: false,
  },
  tail: {
    rootX: 0.9, span: 5.32, rootZ: 14.4, rootY: 0.72,
    rootChord: 3.7, tipChord: 1.2, sweep: 3.1, dihedral: 0.55, thickness: 0.3, tipThickness: 0.08,
  },
  fin: { rootZ: 9.3, rootY: 1.75, height: 6.05, rootChord: 6.0, tipChord: 1.9, sweep: 4.3, thickness: 0.5 },
  canopy: null,
  gear: {
    nose: [0, axleY(A, A.nose.r), A.nose.z], main: [A.main.x, axleY(A, A.main.r), A.main.z],
    noseRadius: A.nose.r, mainRadius: A.main.r,
    noseAttach: [0, -1.55, A.nose.z + 0.15], mainAttach: [A.main.x, -1.45, A.main.z - 0.1],
    retractable: true, dualMain: false, doors: false,
  },
  engines: A.engines.map((e) => ({ id: e.x < 0 ? 'leftEngine' : 'rightEngine', kind: 'jet', x: e.x, y: e.y, z: e.z, radius: e.r, length: e.length })),
  eye: A.eye,
  decorate(ctx) {
    const { parts, materials: m } = ctx;
    const { M } = dress(ctx, A320);
    trailingEdgeFill(ctx, 6.3, 1.65, 0.3);
    // Sharklets: a curved blend out of the tip, then a tall swept fin.
    const w = ctx.config.wing;
    const tip = wingAt(w, w.rootX + w.span);
    for (const s of [-1, 1]) {
      const wing = parts[s < 0 ? 'leftWing' : 'rightWing'];
      const x0 = s * (w.rootX + w.span - 0.05);
      plate(ctx, 'Sharklet blend', [
        [x0, tip.mid, tip.le + 0.05], [x0, tip.mid, tip.te],
        [s * 17.62, tip.mid + 0.62, tip.te + 0.1], [s * 17.62, tip.mid + 0.62, tip.le + 0.55],
      ], 0.13, m.accent, wing);
      plate(ctx, 'Sharklet', [
        [s * 17.62, tip.mid + 0.62, tip.le + 0.55], [s * 17.62, tip.mid + 0.62, tip.te + 0.1],
        [s * 17.9, tip.mid + 2.45, tip.te + 0.5], [s * 17.9, tip.mid + 2.45, tip.te + 0.08],
      ], 0.11, m.accent, wing);
    }
    // Twin-wheel legs, nose and main.
    refitLeg(ctx, 'noseGear', { kind: 'dual', track: 0.52, r: A.nose.r, width: 0.26, oleo: 0.11, mats: M });
    for (const id of ['leftGear', 'rightGear']) refitLeg(ctx, id, { kind: 'dual', track: 0.93, r: A.main.r, width: 0.4, oleo: 0.14, mats: M });
  },
  description: 'A narrow-body twin: slim round fuselage, the Airbus nose with a six-pane windscreen, swept low wing with a cranked trailing edge and sharklets, two turbofans on pylons, twin-wheel gear, doors that open.',
  inspiration: 'Drawn to the A320\'s published dimensions for a children\'s flight game; house livery is the game\'s own.',
};

/* ---------------------------------------------------------------- *
 * 747-400. The main tube has a low round nose; the upper deck is its own
 * loft, rising out of the top of the nose so the top line climbs in one
 * sweep from the radome to the hump, with the flight deck on its front.
 * ---------------------------------------------------------------- */
const B747 = {
  fuselage: {
    stations: [
      st(-31.10, -0.95, -0.95, 0.0, -0.95),
      st(-31.04, -0.6, -1.27, 0.38, -0.95),
      st(-30.92, -0.3, -1.55, 0.72, -0.95),
      st(-30.60, 0.2, -1.95, 1.25, -0.95),
      st(-30.10, 0.85, -2.35, 1.78, -0.92),
      st(-29.40, 1.55, -2.7, 2.25, -0.85),
      st(-28.50, 2.2, -2.98, 2.66, -0.72),
      st(-27.30, 2.78, -3.17, 2.98, -0.52),
      st(-26.00, 3.12, -3.26, 3.16, -0.28),
      st(-24.60, 3.28, -3.3, 3.24, -0.06),
      st(-23.40, 3.3, -3.3, 3.25, 0),
      st(11.0, 3.3, -3.3, 3.25, 0),
      st(16.0, 3.3, -2.55, 3.12, 0.4),
      st(22.0, 3.3, -1.35, 2.75, 1.0),
      ell([28.0, 2.12, 1.72, 1.58]),
      ell([33.5, 1.4, 1.08, 2.2]),
      ell([37.6, 0.72, 0.55, 2.62]),
      ell([39.5, 0.14, 0.14, 2.8]),
    ],
    radial: 18,
    rings: ringsBetween(11.0, 39.5, 2.4),
    cuts: [-21.0, 16.0],
    alongKnots: [[-31.1, 0], [-21.0, 0.17], [39.5, 1]],
  },
  hump: {
    stations: [
      st(-30.35, 0.5, 0.4, 0.0, 0.45),
      st(-30.15, 1.02, 0.3, 0.6, 0.7, 2, 1.6),
      st(-29.80, 1.65, 0.35, 1.12, 1.15, 2, 1.6),
      st(-29.30, 2.4, 0.5, 1.55, 1.75, 2, 1.6),
      st(-28.85, 2.98, 0.65, 1.82, 2.25, 2.1, 1.6),
      st(-28.62, 3.2, 0.75, 1.92, 2.45, 2.1, 1.6),
      st(-28.05, 3.95, 0.85, 2.08, 2.95, 2.2, 1.7),
      st(-27.50, 4.33, 0.95, 2.16, 3.05, 2.2, 1.8),
      st(-26.60, 4.66, 1.0, 2.21, 3.0, 2.2, 1.9),
      st(-25.40, 4.82, 1.0, 2.22, 2.95, 2.1, 2),
      st(-24.40, 4.84, 1.0, 2.22, 2.92),
      st(-8.5, 4.84, 1.0, 2.22, 2.92),
      st(-4.0, 4.38, 1.2, 2.05, 2.78),
      st(0.5, 3.7, 1.7, 1.6, 2.7),
      st(3.0, 3.25, 2.65, 0.9, 2.95),
      st(3.6, 3.1, 2.95, 0.1, 3.02),
    ],
    radial: 14,
    rings: [-6.2, -2.0, 1.8],
  },
  flightDeckOn: 'upper',
  cabinZ: 0,
  bellyY: -1.9,
  laps: [2.25, -1.3],
  radomeZ: -29.7,
  cheat: { y0: -0.26, y1: 0.12, z0: -26.6, z1: 33.0 },
  reg: { z: 29.0, y: 1.55, w: 3.4 },
  // The titling band: on the main tube between the window row and the
  // hump's flank (the tube is wider than the hump up to about y 2.4 there),
  // from behind door 1 to the wing root.
  title: { z: -11.5, y: 1.4, w: 19 },
  frame: 0.075,
  panes: [
    { name: 'Windscreen', wiper: true, corners: [{ z: -28.72, x: 0.07 }, { z: -28.52, y: 3.18 }, { z: -28.06, y: 3.82 }, { z: -28.14, x: 0.07 }] },
    { name: 'Second side window', corners: [{ z: -28.42, y: 3.18 }, { z: -27.55, y: 3.25 }, { z: -27.62, y: 3.95 }, { z: -27.96, y: 3.84 }] },
    { name: 'Rear side window', corners: [{ z: -27.45, y: 3.26 }, { z: -26.85, y: 3.3 }, { z: -27.0, y: 3.9 }, { z: -27.42, y: 3.98 }] },
  ],
  windows: [
    { y: 0.55, z0: -24.0, z1: 29.0, pitch: 0.51, w: 0.25, ht: 0.37,
      skip: [[-23.0, -21.6], [-12.7, -11.3], [-1.6, -0.2], [9.7, 11.1], [21.3, 22.7]] },
    { deck: 'upper', y: 3.55, z0: -24.5, z1: -9.6, pitch: 0.53, w: 0.25, ht: 0.36, skip: [[-17.1, -15.7]] },
  ],
  doors: both([
    { id: '#1', z: -22.3, y: 0.465, w: 1.07, h: 1.93, kind: 'passenger', sill: -0.5 },
    { id: '#2', z: -12.0, y: 0.465, w: 1.07, h: 1.93, kind: 'passenger', sill: -0.5 },
    { id: '#3', z: -0.9, y: 0.465, w: 1.07, h: 1.93, kind: 'passenger', sill: -0.5 },
    { id: '#4', z: 10.4, y: 0.465, w: 1.07, h: 1.93, kind: 'passenger', sill: -0.5 },
    { id: '#5', z: 22.0, y: 0.465, w: 1.07, h: 1.93, kind: 'passenger', sill: -0.5 },
    { id: 'U#1', z: -16.4, y: 3.4, w: 0.92, h: 1.6, kind: 'passenger', deck: 'upper', sill: 2.6 },
  ]),
  fairing: [
    [-14.5, 2.4, 0.5, -2.85], [-10.5, 3.05, 0.95, -2.62], [-4.5, 3.3, 1.15, -2.52],
    [1.5, 3.3, 1.1, -2.55], [5.8, 2.9, 0.78, -2.68], [8.8, 2.0, 0.4, -2.86],
  ],
  aerials: { crown: [-14.0, 9.0, 19.5], belly: [-20.5, -17.5] },
  beaconZ: 7.0,
};

const b747 = {
  id: 'b747', name: 'Boeing 747', kind: 'airliner', massKg: 24000,
  paint: '#f4f6f8', accent: '#123a78', registration: 'N747IF', bodySegments: 8,
  body: bodyOf(B747.fuselage.stations),
  wing: {
    rootX: 2.45, span: B.tip.x - 2.45, rootZ: -12.57, rootY: -2.1,
    rootChord: 13.78, tipChord: 3.6, sweep: 24.25, dihedral: B.tip.y + 2.1,
    thickness: 1.6, tipThickness: 0.28, flaps: true, struts: false,
  },
  tail: {
    rootX: 0.9, span: 10.2, rootZ: 28.8, rootY: 1.75,
    rootChord: 7.4, tipChord: 2.5, sweep: 7.46, dihedral: 1.2, thickness: 0.7, tipThickness: 0.15,
  },
  fin: { rootZ: 23.0, rootY: 3.1, height: 10.4, rootChord: 14.0, tipChord: 4.3, sweep: 11.2, thickness: 1.0 },
  canopy: null,
  gear: {
    nose: [0, axleY(B, B.nose.r), B.nose.z], main: [B.main.x, axleY(B, B.main.r), 0.8],
    noseRadius: B.nose.r, mainRadius: B.main.r,
    noseAttach: [0, -2.55, B.nose.z + 0.2], mainAttach: [B.main.x, -2.2, 0.6],
    retractable: true, dualMain: false, doors: false,
  },
  engines: B.engines.map((e, i) => ({
    id: `${e.x < 0 ? 'left' : 'right'}${i % 2 ? 'Outboard' : 'Inboard'}Engine`,
    kind: 'jet', x: e.x, y: e.y, z: e.z, radius: e.r, length: e.length,
  })),
  eye: B.eye,
  decorate(ctx) {
    const { parts, materials: m } = ctx;
    const { M } = dress(ctx, B747);
    trailingEdgeFill(ctx, 11.5, 3.5, 0.6);
    // Canted winglets.
    const w = ctx.config.wing;
    const tip = wingAt(w, w.rootX + w.span);
    for (const s of [-1, 1]) {
      plate(ctx, 'Winglet', [
        [s * (w.rootX + w.span - 0.05), tip.mid + 0.05, tip.le + 0.8],
        [s * (w.rootX + w.span - 0.05), tip.mid + 0.05, tip.te - 0.1],
        [s * B.span / 2, tip.mid + 1.62, tip.te + 0.35],
        [s * B.span / 2, tip.mid + 1.62, tip.te - 0.6],
      ], 0.16, m.accent, parts[s < 0 ? 'leftWing' : 'rightWing']);
    }
    // Eighteen wheels: two on the nose, four on each of four legs.
    refitLeg(ctx, 'noseGear', { kind: 'dual', track: 0.78, r: B.nose.r, width: 0.36, oleo: 0.16, mats: M });
    const bogies = [];
    for (const id of ['leftGear', 'rightGear']) {
      const b = refitLeg(ctx, id, { kind: 'bogie', axles: 2, pitch: 1.47, track: 1.12, r: B.main.r, width: 0.42, oleo: 0.2, mats: M });
      if (b) bogies.push({ node: b, z: 0.8 });
    }
    for (const s of [-1, 1]) {
      const body = bodyLeg(ctx, s, { x: 1.92, z: 3.7, attachY: -2.5, contactY: B.ground, axles: 2, pitch: 1.47, track: 1.12, r: B.main.r, width: 0.42, oleo: 0.2, mass: 300, mats: M });
      bogies.push({ node: body.bogie, z: 3.7 });
      ctx.registerAnimation((dt, state) => {
        const gear = state.gear ?? 1;
        body.leg.visible = gear > 0.025;
        body.leg.rotation.x = (1 - gear) * 1.45;
      });
    }
    levelBogies(ctx, bogies, B.main.z);
  },
  description: 'The 747-400: long fuselage with the upper-deck hump and its row of windows, the flight deck on top of a round nose, four turbofans on pylons under a 37-degree swept wing, canted winglets, eighteen wheels, doors that open.',
  inspiration: 'Drawn to the 747-400\'s published dimensions for a children\'s flight game; house livery is the game\'s own.',
};

/* ---------------------------------------------------------------- *
 * A380. The flight deck sits between the two decks, so the windscreen
 * is low on a tall nose and a high forehead rises above it to the upper
 * deck's crown. The section is taller than it is wide and squarer on top.
 * ---------------------------------------------------------------- */
const A380 = {
  fuselage: {
    stations: [
      st(-33.60, -1.3, -1.3, 0.0, -1.3),
      st(-33.55, -0.95, -1.65, 0.42, -1.3),
      st(-33.40, -0.62, -2.02, 0.85, -1.32),
      st(-33.10, -0.25, -2.45, 1.32, -1.35),
      st(-32.65, 0.2, -2.9, 1.82, -1.36, 2.05),
      st(-32.25, 0.52, -3.25, 2.15, -1.34, 2.1),
      st(-31.95, 0.95, -3.47, 2.36, -1.3, 2.15),
      st(-31.60, 1.45, -3.68, 2.58, -1.22, 2.2),
      st(-31.10, 2.05, -3.88, 2.82, -1.08, 2.25),
      st(-30.40, 2.75, -4.03, 3.08, -0.9, 2.3),
      st(-29.40, 3.4, -4.13, 3.32, -0.6, 2.3, 2.05),
      st(-28.10, 3.88, -4.18, 3.48, -0.35, 2.3, 2.1),
      st(-26.70, 4.12, -4.2, 3.55, -0.25, 2.3, 2.1),
      st(-25.30, 4.2, -4.2, 3.57, -0.2, 2.3, 2.1),
      st(12.0, 4.2, -4.2, 3.57, -0.2, 2.3, 2.1),
      st(17.0, 4.2, -3.25, 3.45, 0.5, 2.2, 2.05),
      st(23.0, 4.15, -2.02, 3.05, 1.08),
      ell([29.0, 2.35, 2.35, 1.72]),
      ell([34.0, 1.55, 1.45, 2.05]),
      ell([37.5, 0.8, 0.75, 2.35]),
      ell([39.1, 0.15, 0.15, 2.55]),
    ],
    radial: 18,
    rings: ringsBetween(12.0, 39.1, 2.4),
    cuts: [-24.0, 17.0],
    alongKnots: [[-33.6, 0], [-24.0, 0.16], [39.1, 1]],
  },
  cabinZ: 0,
  bellyY: -2.7,
  laps: [3.4, 1.0, -2.2],
  radomeZ: -32.45,
  cheat: { y0: -1.5, y1: -1.08, z0: -29.6, z1: 33.5 },
  reg: { z: 29.5, y: 1.9, w: 3.6 },
  // The titling band: between the two window rows, from behind door 1.
  title: { z: -11.6, y: 1.0, w: 24 },
  frame: 0.08,
  panes: [
    { name: 'Windscreen', wiper: true, corners: [{ z: -32.27, x: 0.08 }, { z: -32.1, x: 1.12 }, { z: -31.62, x: 1.16 }, { z: -31.68, x: 0.08 }] },
    { name: 'Second side window', corners: [{ z: -31.98, y: 0.5 }, { z: -31.15, y: 0.58 }, { z: -31.22, y: 1.3 }, { z: -31.55, y: 1.25 }] },
    { name: 'Rear side window', corners: [{ z: -31.05, y: 0.6 }, { z: -30.45, y: 0.66 }, { z: -30.62, y: 1.24 }, { z: -31.02, y: 1.3 }] },
  ],
  windows: [
    { y: -0.6, z0: -24.0, z1: 25.0, pitch: 0.53, w: 0.3, ht: 0.42,
      skip: [[-25.7, -24.1], [-12.8, -11.2], [-0.1, 1.5], [9.4, 11.0], [18.4, 20.0]] },
    { y: 2.55, z0: -23.5, z1: 26.0, pitch: 0.53, w: 0.3, ht: 0.4,
      skip: [[-21.55, -19.95], [-3.95, -2.35], [16.7, 18.3]] },
  ],
  doors: both([
    { id: '#1', z: -24.9, y: -0.68, w: 1.07, h: 1.93, kind: 'passenger', sill: -1.65 },
    { id: '#2', z: -12.0, y: -0.68, w: 1.07, h: 1.93, kind: 'passenger', sill: -1.65 },
    { id: '#3', z: 0.7, y: -0.68, w: 1.07, h: 1.93, kind: 'passenger', sill: -1.65 },
    { id: '#4', z: 10.2, y: -0.68, w: 1.07, h: 1.93, kind: 'passenger', sill: -1.65 },
    { id: '#5', z: 19.2, y: -0.68, w: 1.07, h: 1.93, kind: 'passenger', sill: -1.65 },
    { id: 'U#1', z: -20.75, y: 2.52, w: 1.07, h: 1.93, kind: 'passenger', deck: 'upper', sill: 1.55 },
    { id: 'U#2', z: -3.15, y: 2.52, w: 1.07, h: 1.93, kind: 'passenger', deck: 'upper', sill: 1.55 },
    { id: 'U#3', z: 17.5, y: 2.52, w: 1.07, h: 1.93, kind: 'passenger', deck: 'upper', sill: 1.55 },
  ]),
  fairing: [
    [-16.0, 2.6, 0.55, -3.75], [-11.5, 3.45, 1.1, -3.45], [-4.5, 3.72, 1.35, -3.3],
    [2.5, 3.72, 1.3, -3.32], [7.2, 3.3, 0.9, -3.5], [10.5, 2.3, 0.45, -3.75],
  ],
  aerials: { crown: [-14.0, 6.0, 20.0], belly: [-24.0, -20.0] },
  beaconZ: -2.0,
};

const a380 = {
  id: 'a380', name: 'Airbus A380', kind: 'airliner', massKg: 27000,
  paint: '#f6f7f9', accent: '#0d6f78', registration: 'N380IF', bodySegments: 8,
  body: bodyOf(A380.fuselage.stations),
  wing: {
    rootX: 2.95, span: C.tip.x - 2.95, rootZ: -12.99, rootY: -2.3,
    rootChord: 16.2, tipChord: 4.0, sweep: 24.84, dihedral: C.tip.y + 2.3,
    thickness: 1.95, tipThickness: 0.35, flaps: true, struts: false,
  },
  tail: {
    rootX: 0.9, span: 14.3, rootZ: 26.3, rootY: 1.85,
    rootChord: 9.4, tipChord: 3.2, sweep: 9.3, dihedral: 1.0, thickness: 0.85, tipThickness: 0.2,
  },
  fin: { rootZ: 20.5, rootY: 3.0, height: 14.3, rootChord: 17.0, tipChord: 5.8, sweep: 12.0, thickness: 1.2 },
  canopy: null,
  gear: {
    nose: [0, axleY(C, C.nose.r), C.nose.z], main: [C.main.x, axleY(C, C.main.r), 0.5],
    noseRadius: C.nose.r, mainRadius: C.main.r,
    noseAttach: [0, -3.4, C.nose.z + 0.2], mainAttach: [C.main.x, -2.5, 0.3],
    retractable: true, dualMain: false, doors: false,
  },
  engines: C.engines.map((e, i) => ({
    id: `${e.x < 0 ? 'left' : 'right'}${i % 2 ? 'Outboard' : 'Inboard'}Engine`,
    kind: 'jet', x: e.x, y: e.y, z: e.z, radius: e.r, length: e.length,
  })),
  eye: C.eye,
  decorate(ctx) {
    const { parts, materials: m } = ctx;
    const { M } = dress(ctx, A380);
    trailingEdgeFill(ctx, 13.5, 3.3, 0.7);
    // Wingtip fences: a swept triangle above the tip and a smaller one below.
    const w = ctx.config.wing;
    const tip = wingAt(w, w.rootX + w.span);
    for (const s of [-1, 1]) {
      const wing = parts[s < 0 ? 'leftWing' : 'rightWing'];
      const x = s * (C.span / 2 - 0.02);
      plate(ctx, 'Wingtip fence', [
        [x, tip.mid + 0.1, tip.le + 0.5], [x, tip.mid + 0.1, tip.te + 0.05],
        [x, tip.mid + 1.75, tip.te + 0.45], [x, tip.mid + 1.75, tip.te + 0.2],
      ], 0.14, m.accent, wing);
      plate(ctx, 'Wingtip fence', [
        [x, tip.mid - 0.08, tip.le - 0.15], [x, tip.mid - 0.08, tip.le + 1.9],
        [x, tip.mid - 0.95, tip.le + 0.25], [x, tip.mid - 0.95, tip.le - 0.3],
      ], 0.14, m.accent, wing);
    }
    // Twenty-two wheels: two on the nose, four on each wing leg, six on each body leg.
    refitLeg(ctx, 'noseGear', { kind: 'dual', track: 0.86, r: C.nose.r, width: 0.4, oleo: 0.18, mats: M });
    const bogies = [];
    for (const id of ['leftGear', 'rightGear']) {
      const b = refitLeg(ctx, id, { kind: 'bogie', axles: 2, pitch: 1.6, track: 1.24, r: C.main.r, width: 0.5, oleo: 0.24, mats: M });
      if (b) bogies.push({ node: b, z: 0.5 });
    }
    for (const s of [-1, 1]) {
      const body = bodyLeg(ctx, s, { x: 2.65, z: 4.4, attachY: -3.0, contactY: C.ground, axles: 3, pitch: 1.55, track: 1.24, r: C.main.r, width: 0.5, oleo: 0.24, mass: 420, mats: M });
      bogies.push({ node: body.bogie, z: 4.4 });
      ctx.registerAnimation((dt, state) => {
        const gear = state.gear ?? 1;
        body.leg.visible = gear > 0.025;
        body.leg.rotation.x = (1 - gear) * 1.45;
      });
    }
    levelBogies(ctx, bogies, C.main.z);
  },
  description: 'The A380: a double-deck fuselage the full length of the aeroplane, the flight deck between the decks under a tall forehead, a huge wing with wingtip fences, four turbofans, twenty-two wheels, doors that open on both decks.',
  inspiration: 'Drawn to the A380-800\'s published dimensions for a children\'s flight game; house livery is the game\'s own.',
};

export const DEFINITIONS = [a320, b747, a380];
export const DRAWS = ['a320', 'b747', 'a380'];

/** For tests and the hangar: each type's fuselage, deck and door specification, in metres. */
export const AIRLINER_SPECS = { a320: A320, b747: B747, a380: A380 };
export { dress as dressAirliner, refitLeg as refitAirlinerLeg, st as hullStation, ell as ellipseStation, bodyOf, ringsBetween };
// The construction helpers, for the airliners drawn since (./jets.js, ./giants.js).
export { plate, wingAt, trailingEdgeFill, paintFin, bodyLeg, levelBogies, tyres, bogie, oleo, findByName };

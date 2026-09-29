/**
 * The three airliners, drawn at full size: Airbus A320, Boeing 747-400 and
 * Airbus A380. Same shape of entry as ../aircraft-combat.js and
 * ../aircraft-transport.js — ordered body stations, wing, tail, fin, gear,
 * engines and a decorate(ctx) for everything that makes the type itself.
 *
 * WHAT MAKES EACH ONE ITSELF FROM 300 m, which is what was checked in the
 * renders and what everything below is in service of:
 *
 *   A320  two engines, a slim tube, sharklets turned up at the tips
 *   747   the hump — a second, narrower loft on top of the first, running
 *         from the nose back to the wing — four engines, canted winglets
 *   A380  a fuselage that is taller than it is wide for its whole length,
 *         two full rows of windows, four engines under an enormous wing and
 *         the little triangular fences at the tips
 *
 * GEOMETRY THAT THE FLIGHT MODEL SHARES. Tyre contact points, the belly, the
 * wing tips and the tail-strike point all come from AIRLINER_GEOMETRY in
 * ../../aircraft/extra/airliners.js, which is also what the physics shape is
 * derived from. The underside of each tail cone was drawn against the strike
 * angle: the physics tail point (0.12 × scale below the centre of gravity)
 * sits on the drawn underside, and the drawn underside nowhere dips below
 * the line from the main wheels at that angle — measured in the test,
 * tests/features/airliners.mjs, not asserted here.
 *
 * Proportions against the real aeroplanes (span : length):
 *   A320  35.80 × 37.57 m  0.953  (with sharklets)
 *   747   64.44 × 70.60 m  0.913  (-400, with winglets)
 *   A380  79.75 × 72.70 m  1.097
 */

import * as THREE from '../../vendor/three.module.js';
import { addInstanced, makeMaterial } from '../common.js';
import { AIRLINER_GEOMETRY as GEO } from '../../aircraft/extra/airliners.js';

const mix = (a, b, t) => a + (b - a) * t;
const clamp = THREE.MathUtils.clamp;

/* ------------------------------------------------------------------ *
 * Shared construction helpers. Everything here runs once, at build time.
 * ------------------------------------------------------------------ */

/** [rx, ry, cy] of a loft at station z, interpolated exactly as the core does. */
function profile(stations, z) {
  let k = 0;
  while (k < stations.length - 2 && stations[k + 1][0] < z) k++;
  const a = stations[k];
  const b = stations[k + 1];
  const t = clamp((z - a[0]) / (b[0] - a[0]), 0, 1);
  return [mix(a[1], b[1], t), mix(a[2], b[2], t), mix(a[3] || 0, b[3] || 0, t)];
}

/** A point on a loft: phi from the top (0) round to the side (pi/2). */
function onLoft(stations, z, phi, off = 0) {
  const [rx, ry, cy] = profile(stations, z);
  return [(rx + off) * Math.sin(phi), cy + (ry + off) * Math.cos(phi), z];
}

/** The point on the loft's right-hand side at height y (x > 0). */
function atHeight(stations, z, y, off = 0) {
  const [rx, ry, cy] = profile(stations, z);
  const d = clamp((y - cy) / (ry + off), -0.999, 0.999);
  const x = (rx + off) * Math.sqrt(1 - d * d);
  // Outward normal of the ellipse at that point.
  const nx = x / ((rx + off) * (rx + off));
  const ny = (y - cy) / ((ry + off) * (ry + off));
  const n = Math.hypot(nx, ny) || 1;
  return { x, n: [nx / n, ny / n] };
}

function own(ctx, geo) {
  return ctx.model.userData.ownGeometry(geo);
}

function meshOf(ctx, name, geo, mat, parent) {
  const m = new THREE.Mesh(own(ctx, geo), mat);
  m.name = name;
  m.castShadow = !mat.transparent;
  m.receiveShadow = true;
  parent.add(m);
  return m;
}

/** Flip every triangle of an indexed or non-indexed geometry. */
function flipWinding(geo) {
  if (geo.index) {
    const ix = geo.index;
    for (let i = 0; i < ix.count; i += 3) {
      const a = ix.getX(i + 1);
      ix.setX(i + 1, ix.getX(i + 2));
      ix.setX(i + 2, a);
    }
    ix.needsUpdate = true;
  }
  geo.computeVertexNormals();
}

/**
 * A curved patch laid on a surface: fn(u, v) -> [x, y, z]. `outward` gives the
 * direction the face must point at its middle; the winding is flipped to
 * match, so nothing here depends on remembering which way PlaneGeometry winds.
 */
function surfacePatch(ctx, name, fn, nu, nv, mat, parent, outward) {
  const geo = new THREE.PlaneGeometry(1, 1, nu, nv);
  const p = geo.attributes.position;
  const uv = geo.attributes.uv;
  for (let i = 0; i < p.count; i++) p.setXYZ(i, ...fn(uv.getX(i), uv.getY(i)));
  geo.computeVertexNormals();
  const mid = fn(0.5, 0.5);
  const want = outward(mid);
  const nrm = new THREE.Vector3();
  const idx = Math.floor(p.count / 2);
  nrm.fromBufferAttribute(geo.attributes.normal, idx);
  if (nrm.x * want[0] + nrm.y * want[1] + nrm.z * want[2] < 0) flipWinding(geo);
  return meshOf(ctx, name, geo, mat, parent);
}

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

const _qz = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, Math.PI / 2));

/** Instanced tyres, axles along X. One material, so one draw call per leg (the core's three-material tyre is three). */
function tyres(ctx, parent, name, centres, r, width) {
  const geo = new THREE.CylinderGeometry(r, r, width, 14);
  const m = ctx.materials;
  const mats = centres.map((c) =>
    new THREE.Matrix4().compose(new THREE.Vector3(...c), _qz, new THREE.Vector3(1, 1, 1))
  );
  const mesh = addInstanced(ctx.model, parent, name, geo, m.rubber, mats);
  mesh.computeBoundingBox();
  mesh.computeBoundingSphere();
  return mesh;
}

/**
 * A bogie: a beam with `axles` pairs of wheels, centred on its own pivot so
 * it can be tilted. Returned group is positioned by the caller.
 */
function bogie(ctx, parent, label, { axles, pitch, track, r, width }) {
  const g = new THREE.Group();
  g.name = label;
  parent.add(g);
  const centres = [];
  const half = ((axles - 1) * pitch) / 2;
  for (let i = 0; i < axles; i++) {
    const z = -half + i * pitch;
    for (const x of [-track / 2, track / 2]) centres.push([x, 0, z]);
  }
  tyres(ctx, g, `${label} tyres`, centres, r, width);
  ctx.box(`${label} beam`, [0.26, 0.24, half * 2 + r * 0.9], [0, r * 0.15, 0], ctx.materials.metal, g);
  for (let i = 0; i < axles; i++) {
    ctx.tube(`${label} axle`, [-track / 2, 0, -half + i * pitch], [track / 2, 0, -half + i * pitch], 0.07, ctx.materials.metal, g, 6);
  }
  return g;
}

/**
 * Replace the core's single tyre on a leg with the real arrangement.
 *
 *   dual   two wheels side by side on the axle (A320 mains, every nose leg);
 *          they stay in the core's rolling wheel group, so they still steer
 *          and turn
 *   bogie  a tilting beam of 2 or 3 axle pairs (747 and A380 wing gear)
 */
function refitLeg(ctx, legId, opt) {
  const leg = ctx.parts[legId];
  if (!leg) return null;
  const wheel = findByName(leg, 'Rolling wheels');
  const axle = findByName(leg, 'Suspending axle');
  const steering = findByName(leg, 'Wheel steering');
  const old = wheel && wheel.children.find((c) => c.name === 'Tyres and hubs');
  if (old) old.removeFromParent();
  // A fatter oleo cylinder over the top half of the core's thin strut.
  const rel = steering ? steering.position : new THREE.Vector3(0, -1, 0);
  ctx.tube('Oleo cylinder', [0, 0.1, 0], [rel.x * 0.55, rel.y * 0.55, rel.z * 0.55], opt.oleo, ctx.materials.metal, leg, 8);
  if (opt.kind === 'dual') {
    tyres(ctx, wheel, 'Twin tyres', [[-opt.track / 2, 0, 0], [opt.track / 2, 0, 0]], opt.r, opt.width);
    return null;
  }
  const b = bogie(ctx, axle, `${legId} bogie`, opt);
  b.position.copy(rel);
  return b;
}

/**
 * A body-gear leg the core does not know about (747: four wheels, A380: six),
 * with its own retraction — forwards into the belly, as the real ones go.
 */
function bodyLeg(ctx, side, { x, z, attachY, contactY, axles, pitch, track, r, width, oleo, mass }) {
  const id = side < 0 ? 'leftBodyGear' : 'rightBodyGear';
  const g = ctx.group(id, side < 0 ? 'Port body landing gear' : 'Starboard body landing gear', mass, 'fuselage', ctx.parts.fuselage);
  g.position.set(side * x, attachY, z);
  const drop = contactY + r - attachY; // negative: from the attach down to the axle
  ctx.tube('Body gear oleo', [0, 0.1, 0], [0, drop, 0], oleo, ctx.materials.metal, g, 8);
  ctx.tube('Body gear drag brace', [0, drop * 0.35, -0.9], [0, drop * 0.8, 0], oleo * 0.45, ctx.materials.metal, g, 6);
  const b = bogie(ctx, g, `${id} bogie`, { axles, pitch, track, r, width });
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
 * Every cabin window of the aeroplane as ONE instanced mesh — both sides,
 * every deck — so three hundred windows are a single draw call. Each pane is
 * turned to the fuselage's own surface normal at its height, not just faced
 * sideways, so the upper deck windows lean in with the roof as they should.
 */
function windowRows(ctx, stations, rows, parent) {
  const mats = [];
  const up = new THREE.Vector3(0, 1, 0);
  const pos = new THREE.Vector3();
  const tgt = new THREE.Vector3();
  const quat = new THREE.Quaternion();
  const scl = new THREE.Vector3();
  const look = new THREE.Matrix4();
  for (const row of rows) {
    for (let i = 0; i < row.count; i++) {
      const z = mix(row.z0, row.z1, row.count === 1 ? 0.5 : i / (row.count - 1));
      if ((row.skip || []).some(([a, b]) => z > a && z < b)) continue;
      const { x, n } = atHeight(row.st || stations, z, row.y, 0.02);
      for (const side of [-1, 1]) {
        pos.set(side * x, row.y, z);
        tgt.set(pos.x + side * n[0], pos.y + n[1], pos.z);
        // Matrix4.lookAt points +Z from target to eye: eye outside, target on the skin.
        look.lookAt(tgt, pos, up);
        quat.setFromRotationMatrix(look);
        scl.set(row.w, row.h, 1);
        mats.push(new THREE.Matrix4().compose(pos, quat, scl));
      }
    }
  }
  const geo = new THREE.PlaneGeometry(1, 1);
  const mesh = addInstanced(ctx.model, parent, 'Cabin window rows', geo, ctx.materials.dark, mats);
  mesh.castShadow = false;
  mesh.computeBoundingSphere();
  return mesh;
}

/** Door outlines: a dark frame with the paint inside it and a porthole. */
function doors(ctx, stations, list, parent) {
  const frames = [];
  const panels = [];
  const ports = [];
  const up = new THREE.Vector3(0, 1, 0);
  const look = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  for (const d of list) {
    const { x, n } = atHeight(d.st || stations, d.z, d.y, 0.02);
    for (const side of [-1, 1]) {
      const pos = new THREE.Vector3(side * x, d.y, d.z);
      const out = new THREE.Vector3(side * n[0], n[1], 0);
      look.lookAt(pos.clone().add(out), pos, up);
      q.setFromRotationMatrix(look);
      frames.push(new THREE.Matrix4().compose(pos.clone().addScaledVector(out, 0.005), q, new THREE.Vector3(d.w, d.h, 1)));
      panels.push(new THREE.Matrix4().compose(pos.clone().addScaledVector(out, 0.012), q, new THREE.Vector3(d.w - 0.07, d.h - 0.07, 1)));
      ports.push(new THREE.Matrix4().compose(pos.clone().addScaledVector(out, 0.02).add(new THREE.Vector3(0, d.h * 0.22, 0)), q, new THREE.Vector3(0.2, 0.28, 1)));
    }
  }
  const paint = makeMaterial(ctx.model, { color: ctx.config.paint, roughness: 0.5, metalness: 0.12 });
  const plane = () => new THREE.PlaneGeometry(1, 1);
  for (const [name, mats, mat] of [['Door seams', frames, ctx.materials.dark], ['Doors', panels, paint], ['Door windows', ports, ctx.materials.dark]]) {
    const m = addInstanced(ctx.model, parent, name, plane(), mat, mats);
    m.castShadow = false;
    m.computeBoundingSphere();
  }
}

/**
 * The flight-deck glazing: each pane a dark curved patch laid on the nose,
 * with a thin sheet of reflective glass just outside it. Both are one-sided
 * and face outwards, so from the cockpit they are culled and the view out is
 * clear.
 */
function flightDeck(ctx, stations, panes, parent) {
  /*
   * The game's glass is double-sided so a bubble canopy shows from inside.
   * Here that put six large tinted trapezoids across the cockpit view with
   * clear gaps between them where the (culled) frames are — seen in the game
   * from the 747's left seat. One-sided, the outside keeps its reflective
   * glazing and the inside gets the same clean view every other aeroplane
   * has in the default cockpit view.
   */
  const glass = ctx.model.userData.ownMaterial(ctx.materials.glass.clone());
  glass.side = THREE.FrontSide;
  glass.name = 'Aircraft_flight_deck_glazing';
  for (const p of panes) {
    for (const side of [-1, 1]) {
      const fn = (off) => (u, v) => {
        const z = mix(p.z0, p.z1, v);
        const phi = mix(mix(p.phi0[0], p.phi0[1], v), mix(p.phi1[0], p.phi1[1], v), u);
        const q = onLoft(stations, z, phi, off);
        return [side * q[0], q[1], q[2]];
      };
      const outward = ([x, y, z]) => {
        const [, , cy] = profile(stations, z);
        return [x, y - cy, 0];
      };
      // Eight rows along the aeroplane, not two: a pane that crosses a loft
      // station is laid over a crease in the skin, and with only its edges and
      // middle on the surface the crease poked through the glass as a white
      // chevron (seen in the 747 render, where the pane spans z = -29.2).
      surfacePatch(ctx, 'Flight deck window', fn(0.04), 3, 8, ctx.materials.dark, parent, outward);
      surfacePatch(ctx, 'Flight deck glass', fn(0.055), 3, 8, glass, parent, outward);
    }
  }
}

/* ------------------------------------------------------------------ *
 * Engines, pylons, wing details.
 * ------------------------------------------------------------------ */

/**
 * Turn the core's jet pod into a high-bypass turbofan: its own pylon rising
 * from the nacelle to the wing (the core's generic pylon is removed — it
 * stands vertically at mid-nacelle and misses a swept wing's leading edge),
 * a grey core cowl stepping down out of the fan duct, and an exhaust plug.
 */
function turbofans(ctx) {
  const w = ctx.config.wing;
  const m = ctx.materials;
  for (const e of ctx.config.engines) {
    const g = ctx.parts[e.id];
    if (!g) continue;
    const old = g.children.filter((c) => c.name === 'Engine support pylon');
    for (const o of old) o.removeFromParent();
    const r = e.radius;
    const L = e.length;
    const zf = e.z - L / 2;
    const zb = e.z + L / 2;
    // Core cowl and plug.
    const cowl = new THREE.CylinderGeometry(r * 0.4, r * 0.55, L * 0.42, 16, 1, true);
    cowl.rotateX(Math.PI / 2);
    cowl.translate(e.x, e.y, zb + L * 0.21);
    meshOf(ctx, 'Core cowl', cowl, m.metal, g);
    const plug = new THREE.CylinderGeometry(0.02, r * 0.27, L * 0.3, 12);
    plug.rotateX(Math.PI / 2);
    plug.translate(e.x, e.y, zb + L * 0.42 + L * 0.15);
    meshOf(ctx, 'Exhaust plug', plug, m.dark, g);
    // Pylon: sloped leading edge from the top of the fan cowl up to the wing.
    const wa = wingAt(w, e.x);
    const topY = e.y + r * 0.93;
    plate(ctx, 'Engine pylon', [
      [e.x, topY - 0.12, zf + L * 0.3],
      [e.x, e.y + r * 0.5, zb + L * 0.32],
      [e.x, wa.mid, wa.le + wa.chord * 0.55],
      [e.x, wa.under + 0.05, wa.le - 0.25],
    ], r * 0.3, m.skin, g);
  }
}

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

/** The fin in livery colour: an overlay a shade proud of the core's fin. */
function paintFin(ctx, from = 0.1) {
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
  meshOf(ctx, 'Painted fin', geo, ctx.materials.accent, fin);
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
  meshOf(ctx, 'Painted rudder', rg, ctx.materials.accent, rudder);
}

/** The APU exhaust at the very tip of the tail cone. */
function apu(ctx, stations) {
  const last = stations[stations.length - 1];
  const tube = new THREE.CylinderGeometry(last[1] * 1.6, last[1] * 2.2, 0.5, 10, 1, true);
  tube.rotateX(Math.PI / 2);
  tube.translate(0, last[3], last[0] - 0.2);
  meshOf(ctx, 'APU exhaust', tube, ctx.materials.dark, ctx.parts.tail);
}

/**
 * Open the seams between the three fuselage sections.
 *
 * The core lofts the nose, cabin and tail as separate closed cylinders so each
 * can break away on its own, and every closed cylinder has a lid at each end.
 * The lid at the back of the nose section faces aft — straight at the pilot,
 * whose eye is behind it on all three of these. From the cockpit view the
 * whole windscreen was a white disc 0.4 m away (found by raycasting from the
 * A380's eye: "Tapered nose", normal +Z, 0.40 m). The internal lids are never
 * seen from outside, so they go; the tip caps at the nose and tail stay.
 */
function openSeams(ctx) {
  const drop = (mesh, top, bottom) => {
    const g = mesh && mesh.geometry;
    if (!g || !g.index || g.groups.length < 3) return;
    const idx = g.index.array;
    const keep = [];
    g.groups.forEach((gr, i) => {
      // CylinderGeometry: group 1 is the top cap (the front station, as
      // skin() maps it), group 2 the bottom cap (the last station).
      if ((i === 1 && top) || (i === 2 && bottom)) return;
      for (let k = gr.start; k < gr.start + gr.count; k++) keep.push(idx[k]);
    });
    g.setIndex(keep);
    g.clearGroups();
  };
  const find = (part, name) => part && part.children.find((c) => c.name === name);
  drop(find(ctx.parts.nose, 'Tapered nose'), false, true);
  drop(find(ctx.parts.fuselage, 'Shaped cabin fuselage'), true, true);
  drop(find(ctx.parts.tail, 'Tapered aft fuselage'), true, false);
}

/** A belly fairing where the wing meets the body. */
function bellyFairing(ctx, stations) {
  const m = ctx.skin(stations, ctx.materials.skin, ctx.parts.fuselage, 18);
  m.name = 'Wing-body fairing';
  return m;
}

/* ------------------------------------------------------------------ *
 * The aeroplanes.
 * ------------------------------------------------------------------ */

const A = GEO.a320;
const B = GEO.b747;
const C = GEO.a380;

/** Axle height: the contact point plus a tyre radius. */
const axleY = (g, r) => g.ground + r;

const a320Body = [
  [-16.8, 0.06, 0.06, -0.55],
  [-16.6, 0.55, 0.62, -0.47],
  [-16.15, 1.02, 1.1, -0.34],
  [-15.45, 1.42, 1.5, -0.22],
  [-14.55, 1.72, 1.8, -0.12],
  [-13.45, 1.9, 1.99, -0.04],
  [-12.2, 1.975, 2.07, 0],
  [5.5, 1.975, 2.07, 0],
  [9.0, 1.9, 1.93, 0.14],
  [12.5, 1.62, 1.55, 0.42],
  [16.0, 1.12, 1.0, 0.78],
  [18.8, 0.62, 0.52, 1.02],
  [20.2, 0.3, 0.28, 1.12],
  [20.77, 0.1, 0.1, 1.15],
];

const a320 = {
  id: 'a320', name: 'Airbus A320', kind: 'airliner', massKg: 18000,
  paint: '#f5f7f9', accent: '#c4122f', registration: 'N320IF', bodySegments: 20,
  body: a320Body,
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
    openSeams(ctx);
    turbofans(ctx);
    trailingEdgeFill(ctx, 6.3, 1.65, 0.3);
    paintFin(ctx);
    apu(ctx, a320Body);
    bellyFairing(ctx, [
      [-5.6, 1.2, 0.3, -1.75], [-3.6, 1.8, 0.62, -1.6], [-0.5, 1.98, 0.72, -1.52],
      [2.4, 1.95, 0.68, -1.55], [4.6, 1.45, 0.38, -1.72], [5.6, 0.9, 0.2, -1.8],
    ]);
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
    refitLeg(ctx, 'noseGear', { kind: 'dual', track: 0.52, r: A.nose.r, width: 0.26, oleo: 0.11 });
    for (const id of ['leftGear', 'rightGear']) refitLeg(ctx, id, { kind: 'dual', track: 0.93, r: A.main.r, width: 0.4, oleo: 0.14 });
    windowRows(ctx, a320Body, [
      { y: 0.42, z0: -11.0, z1: 11.2, count: 43, w: 0.24, h: 0.34, skip: [[-2.1, -1.2], [0.1, 0.9]] },
    ], parts.fuselage);
    doors(ctx, a320Body, [
      { z: -12.0, y: -0.02, w: 0.82, h: 1.85 }, { z: 12.3, y: 0.24, w: 0.8, h: 1.8 },
    ], parts.fuselage);
    flightDeck(ctx, a320Body, [
      { z0: -15.3, z1: -14.55, phi0: [0.1, 0.1], phi1: [0.62, 0.62] },
      { z0: -14.48, z1: -13.62, phi0: [0.7, 0.7], phi1: [1.12, 1.1] },
      { z0: -13.55, z1: -13.0, phi0: [0.75, 0.76], phi1: [1.05, 1.03] },
    ], parts.nose);
  },
  description: 'A narrow-body twin: slim round fuselage, swept low wing with a cranked trailing edge and sharklets, two turbofans on pylons, twin-wheel gear.',
  inspiration: 'Drawn to the A320\'s published dimensions for a children\'s flight game; house livery is the game\'s own.',
};

/* ---------------------------------------------------------------- */

const b747Body = [
  [-31.1, 0.07, 0.07, -0.95],
  [-30.8, 0.78, 0.8, -0.85],
  [-30.15, 1.45, 1.5, -0.62],
  [-29.2, 2.1, 2.18, -0.4],
  [-27.85, 2.68, 2.78, -0.2],
  [-26.2, 3.08, 3.18, -0.06],
  [-24.2, 3.25, 3.3, 0],
  [11.0, 3.25, 3.3, 0],
  [16.0, 3.12, 2.95, 0.4],
  [22.0, 2.75, 2.35, 1.0],
  [28.0, 2.12, 1.72, 1.58],
  [33.5, 1.4, 1.08, 2.2],
  [37.6, 0.72, 0.55, 2.62],
  [39.5, 0.14, 0.14, 2.8],
];

/**
 * The upper deck, lofted separately and sat on top of the main tube.
 *
 * Its roof is 1.54 m above the main crown. It was 1.24, and in the game from
 * 300 m, side on, the 747 and the A380 were two white tubes with a coloured
 * fin: the hump read as a slight thickening of the nose rather than the step
 * in the roof line that makes a 747 a 747 from any distance.
 */
const b747Hump = [
  [-30.0, 0.85, 0.65, 0.55],
  [-29.2, 1.55, 1.27, 1.28],
  [-28.2, 1.95, 1.7, 2.1],
  [-26.9, 2.15, 1.88, 2.7],
  [-25.0, 2.22, 1.92, 2.92],
  [-8.5, 2.22, 1.92, 2.92],
  [-4.0, 2.05, 1.6, 2.78],
  [0.5, 1.6, 1.0, 2.7],
  [3.0, 0.9, 0.3, 2.95],
];

const b747 = {
  id: 'b747', name: 'Boeing 747', kind: 'airliner', massKg: 24000,
  paint: '#f4f6f8', accent: '#123a78', registration: 'N747IF', bodySegments: 22,
  body: b747Body,
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
    // The hump, and the flight deck on the front of it.
    const hump = ctx.skin(b747Hump, m.skin, parts.fuselage, 18);
    hump.name = 'Upper deck';
    openSeams(ctx);
    turbofans(ctx);
    trailingEdgeFill(ctx, 11.5, 3.5, 0.6);
    paintFin(ctx);
    apu(ctx, b747Body);
    bellyFairing(ctx, [
      [-14.5, 2.4, 0.5, -2.85], [-10.5, 3.05, 0.95, -2.62], [-4.5, 3.3, 1.15, -2.52],
      [1.5, 3.3, 1.1, -2.55], [5.8, 2.9, 0.78, -2.68], [8.8, 2.0, 0.4, -2.86],
    ]);
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
    refitLeg(ctx, 'noseGear', { kind: 'dual', track: 0.78, r: B.nose.r, width: 0.36, oleo: 0.16 });
    const bogies = [];
    for (const id of ['leftGear', 'rightGear']) {
      const b = refitLeg(ctx, id, { kind: 'bogie', axles: 2, pitch: 1.47, track: 1.12, r: B.main.r, width: 0.42, oleo: 0.2 });
      if (b) bogies.push({ node: b, z: 0.8 });
    }
    for (const s of [-1, 1]) {
      const body = bodyLeg(ctx, s, { x: 1.92, z: 3.7, attachY: -2.5, contactY: B.ground, axles: 2, pitch: 1.47, track: 1.12, r: B.main.r, width: 0.42, oleo: 0.2, mass: 300 });
      bogies.push({ node: body.bogie, z: 3.7 });
      ctx.registerAnimation((dt, state) => {
        const gear = state.gear ?? 1;
        body.leg.visible = gear > 0.025;
        body.leg.rotation.x = (1 - gear) * 1.45;
      });
    }
    levelBogies(ctx, bogies, B.main.z);
    // Main deck and upper deck in one instanced mesh; `st` says which loft a
    // row or a door sits on.
    windowRows(ctx, b747Body, [
      { y: 0.55, z0: -24.2, z1: 29.0, count: 88, w: 0.25, h: 0.37,
        skip: [[-23.2, -21.4], [-12.8, -11.2], [-1.7, -0.1], [9.6, 11.2], [21.2, 22.8]] },
      { st: b747Hump, y: 3.45, z0: -24.0, z1: -8.0, count: 12, w: 0.25, h: 0.36, skip: [[-17.0, -15.8]] },
    ], parts.fuselage);
    doors(ctx, b747Body, [
      { z: -22.3, y: 0.1, w: 1.07, h: 1.93 }, { z: -12.0, y: 0.1, w: 1.07, h: 1.93 },
      { z: -0.9, y: 0.1, w: 1.07, h: 1.93 }, { z: 10.4, y: 0.1, w: 1.07, h: 1.93 },
      { z: 22.0, y: 0.25, w: 1.07, h: 1.9 },
      { st: b747Hump, z: -16.4, y: 3.25, w: 0.9, h: 1.6 },
    ], parts.fuselage);
    flightDeck(ctx, b747Hump, [
      { z0: -29.35, z1: -28.35, phi0: [0.1, 0.08], phi1: [0.6, 0.6] },
      { z0: -28.25, z1: -27.35, phi0: [0.68, 0.66], phi1: [1.05, 1.02] },
      { z0: -27.25, z1: -26.7, phi0: [0.7, 0.7], phi1: [0.98, 0.97] },
    ], parts.fuselage);
  },
  description: 'The 747-400: long fuselage with the upper-deck hump and flight deck on top, four turbofans on pylons under a 37-degree swept wing, canted winglets, eighteen wheels.',
  inspiration: 'Drawn to the 747-400\'s published dimensions for a children\'s flight game; house livery is the game\'s own.',
};

/* ---------------------------------------------------------------- */

const a380Body = [
  [-33.6, 0.09, 0.09, -1.3],
  [-33.25, 1.0, 1.1, -1.12],
  [-32.5, 1.85, 2.15, -0.8],
  [-31.3, 2.62, 3.05, -0.45],
  [-29.7, 3.18, 3.7, -0.16],
  [-27.7, 3.5, 4.08, -0.02],
  [-25.6, 3.57, 4.2, 0],
  [12.0, 3.57, 4.2, 0],
  [17.0, 3.45, 3.75, 0.5],
  [23.0, 3.05, 3.1, 1.08],
  [29.0, 2.35, 2.35, 1.72],
  [34.0, 1.55, 1.45, 2.05],
  [37.5, 0.8, 0.75, 2.35],
  [39.1, 0.15, 0.15, 2.55],
];

const a380 = {
  id: 'a380', name: 'Airbus A380', kind: 'airliner', massKg: 27000,
  paint: '#f6f7f9', accent: '#0d6f78', registration: 'N380IF', bodySegments: 24,
  body: a380Body,
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
    openSeams(ctx);
    turbofans(ctx);
    trailingEdgeFill(ctx, 13.5, 3.3, 0.7);
    paintFin(ctx);
    apu(ctx, a380Body);
    bellyFairing(ctx, [
      [-16.0, 2.6, 0.55, -3.75], [-11.5, 3.45, 1.1, -3.45], [-4.5, 3.72, 1.35, -3.3],
      [2.5, 3.72, 1.3, -3.32], [7.2, 3.3, 0.9, -3.5], [10.5, 2.3, 0.45, -3.75],
    ]);
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
    refitLeg(ctx, 'noseGear', { kind: 'dual', track: 0.86, r: C.nose.r, width: 0.4, oleo: 0.18 });
    const bogies = [];
    for (const id of ['leftGear', 'rightGear']) {
      const b = refitLeg(ctx, id, { kind: 'bogie', axles: 2, pitch: 1.6, track: 1.24, r: C.main.r, width: 0.5, oleo: 0.24 });
      if (b) bogies.push({ node: b, z: 0.5 });
    }
    for (const s of [-1, 1]) {
      const body = bodyLeg(ctx, s, { x: 2.65, z: 4.4, attachY: -3.0, contactY: C.ground, axles: 3, pitch: 1.55, track: 1.24, r: C.main.r, width: 0.5, oleo: 0.24, mass: 420 });
      bogies.push({ node: body.bogie, z: 4.4 });
      ctx.registerAnimation((dt, state) => {
        const gear = state.gear ?? 1;
        body.leg.visible = gear > 0.025;
        body.leg.rotation.x = (1 - gear) * 1.45;
      });
    }
    levelBogies(ctx, bogies, C.main.z);
    // Two full decks.
    windowRows(ctx, a380Body, [
      { y: -0.6, z0: -26.5, z1: 30.0, count: 90, w: 0.3, h: 0.42,
        skip: [[-25.9, -24.2], [-12.9, -11.1], [-0.2, 1.6], [13.6, 15.4], [25.2, 27.0]] },
      { y: 2.55, z0: -24.5, z1: 26.5, count: 80, w: 0.3, h: 0.4,
        skip: [[-21.6, -19.9], [-4.0, -2.3], [18.3, 20.0]] },
    ], parts.fuselage);
    doors(ctx, a380Body, [
      { z: -25.05, y: -0.9, w: 1.07, h: 1.93 }, { z: -12.0, y: -0.9, w: 1.07, h: 1.93 },
      { z: 0.7, y: -0.9, w: 1.07, h: 1.93 }, { z: 14.5, y: -0.9, w: 1.07, h: 1.93 },
      { z: 26.1, y: -0.6, w: 1.07, h: 1.93 },
      { z: -20.75, y: 2.25, w: 1.07, h: 1.9 }, { z: -3.15, y: 2.25, w: 1.07, h: 1.9 },
      { z: 19.15, y: 2.3, w: 1.07, h: 1.85 },
    ], parts.fuselage);
    flightDeck(ctx, a380Body, [
      { z0: -32.75, z1: -32.0, phi0: [0.1, 0.09], phi1: [0.58, 0.55] },
      { z0: -31.95, z1: -31.15, phi0: [0.66, 0.64], phi1: [0.98, 0.95] },
      { z0: -31.1, z1: -30.55, phi0: [0.7, 0.7], phi1: [0.92, 0.92] },
    ], parts.nose);
  },
  description: 'The A380: a double-deck fuselage the full length of the aeroplane, a huge wing with wingtip fences, four turbofans, twenty-two wheels.',
  inspiration: 'Drawn to the A380-800\'s published dimensions for a children\'s flight game; house livery is the game\'s own.',
};

export const DEFINITIONS = [a320, b747, a380];
export const DRAWS = ['a320', 'b747', 'a380'];

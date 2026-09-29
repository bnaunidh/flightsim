/**
 * Parts more than one civil airframe uses: the tail group, an oleo gear leg,
 * a row of cabin windows, a jet nacelle. Each takes the Builder from
 * civil-build.js and adds to it; nothing here keeps state of its own.
 */
import * as THREE from '../../vendor/three.module.js';
import { wing, tubePath, turned, plainUV } from './civil-kit.js';

const X = new THREE.Vector3(1, 0, 0);

/**
 * Fin with rudder and a dorsal fillet, and a tailplane with elevators.
 *
 * fin: { base (y at the root), le (z of the root leading edge), root, tip
 *        (chords), height, sweep (tip LE aft of root LE), dorsal: { len,
 *        rise }, hinge, t }
 * stab: { y, le, root, tip, span (per side, from the centreline), sweep,
 *         dihedral, hinge, inner (where the elevator starts), t }
 */
export function tailGroup(b, { fin, stab }) {
  const { m } = b;
  const F = fin;
  const d = F.dorsal || { len: 0.8, rise: 0.12 };
  const finStations = [
    { s: -0.14, chord: F.root + d.len + 0.25, le: F.le - d.len - 0.25, y: 0 },
    { s: d.rise * 0.35, chord: F.root + d.len * 0.62, le: F.le - d.len * 0.62, y: 0 },
    { s: d.rise, chord: F.root, le: F.le, y: 0 },
    { s: F.height, chord: F.tip, le: F.le + F.sweep, y: 0 },
  ];
  const f = wing({
    frame: 'fin',
    origin: [0, F.base, 0],
    stations: finStations,
    t: F.t ?? 0.1,
    m: 0,
    steps: 6,
    cuts: [{ name: 'rudder', s0: d.rise + 0.01, s1: F.height - (F.rudderTop ?? 0.08), hinge: F.hinge ?? 0.62 }],
    tipRound: F.round ?? 0.07,
    uvV: [0.66, 0.98],
  });
  b.put(f.fixed, m.tail);
  b.addSurface('rudder', f.surfaces.rudder, m.tailMatte);

  const T = stab;
  const hStations = [
    { s: 0, chord: T.root, le: T.le, y: T.y },
    { s: T.span, chord: T.tip, le: T.le + T.sweep, y: T.y + (T.dihedral || 0) },
  ];
  for (const side of ['right', 'left']) {
    const s = wing({
      frame: side,
      stations: hStations,
      t: T.t ?? 0.1,
      m: 0,
      steps: 6,
      cuts: [{ name: 'elevator', s0: T.inner ?? 0.16, s1: T.span - (T.outer ?? 0.1), hinge: T.hinge ?? 0.62 }],
      tipRound: T.round ?? 0.08,
    });
    b.put(s.fixed, T.mat === 'tail' ? m.tail : m.body);
    b.addSurface('elevator', s.surfaces.elevator, T.mat === 'tail' ? m.tailMatte : m.matte);
  }
  return f;
}

/**
 * An oleo leg: a cylinder from the attachment down to a chromed piston, a
 * torque link, and one or two wheels on the axle.
 *
 * { top, axle (centre of the axle, aircraft coords), R, width, twin: gap
 *   between the two tyres' centres (0 for one), fold: { axis, angle },
 *   door: 'outboard' | 'front' | null, steer, name, rake }
 */
export function oleoLeg(b, o) {
  const { m } = b;
  const rec = b.addLeg({ pivot: o.top, axis: o.fold ? o.fold.axis : X, angle: o.fold ? o.fold.angle : 0, name: o.name || 'gear leg' });
  const top = new THREE.Vector3(...o.top);
  const axle = new THREE.Vector3(...o.axle);
  const len = top.distanceTo(axle);
  const rOut = o.strut ?? Math.max(0.045, o.R * 0.22);
  const upper = top.clone().lerp(axle, 0.62);
  const lower = axle.clone().add(new THREE.Vector3(0, o.R * 0.15, 0));
  rec.add(tubePath([top, upper], rOut, 8), m.grey);
  rec.add(tubePath([upper.clone().add(new THREE.Vector3(0, 0.02, 0)), lower], rOut * 0.62, 8), m.metal);
  // Torque link: a small scissor on the front of the leg.
  const mid = top.clone().lerp(axle, 0.75);
  rec.add(
    tubePath(
      [upper.clone().add(new THREE.Vector3(0, -0.02, -rOut * 1.1)), mid.clone().add(new THREE.Vector3(0, 0, -rOut * 2.2)), lower.clone().add(new THREE.Vector3(0, 0.02, -rOut * 1.1))],
      rOut * 0.3,
      5
    ),
    m.grey
  );
  const twin = o.twin || 0;
  if (twin) {
    // The axle across both tyres.
    rec.add(tubePath([axle.clone().add(new THREE.Vector3(-twin / 2, 0, 0)), axle.clone().add(new THREE.Vector3(twin / 2, 0, 0))], o.R * 0.16, 6), m.grey);
  }
  const w = b.addWheel(rec, [axle.x, axle.y, axle.z], o.R, o.width, { steer: !!o.steer, twin });
  const wheels = [w];
  const holder = w.holder;
  if (o.door) {
    // A gear door riding on the leg: the panel that closes the well.
    const w = o.doorWidth ?? o.R * 1.5;
    const h = len * 0.8;
    const g = plainUV(new THREE.BoxGeometry(o.door === 'front' ? w : 0.02, h, o.door === 'front' ? 0.02 : w));
    const c = top.clone().lerp(axle, 0.45);
    const dx = o.door === 'outboard' ? Math.sign(o.top[0] || 1) * (rOut + 0.03) : 0;
    const dz = o.door === 'front' ? -(rOut + 0.03) : 0;
    rec.add(g, m.body, { p: [c.x + dx, c.y, c.z + dz] });
  }
  return { rec, wheels, holder, len };
}

/**
 * Cabin windows that are not part of the hull grid: rounded panes laid on
 * the skin at their own station, facing the way the skin faces there. For
 * rows of passenger windows, which are too small and too many for the grid.
 *
 * { z0, z1, pitch, y (height above the axis), w, h, sides, skip: [z...] }
 */
export function windowRow(b, hull, o) {
  if (!b.m.glassDecal) {
    b.m.glassDecal = b.m.glass.clone();
    b.m.glassDecal.polygonOffset = true;
    b.m.glassDecal.polygonOffsetFactor = -2;
    b.m.glassDecal.polygonOffsetUnits = -2;
  }
  const pane = roundedRect(o.w, o.h, o.r ?? Math.min(o.w, o.h) * 0.35, 1);
  const n = Math.floor((o.z1 - o.z0) / o.pitch + 1e-6) + 1;
  const P = new THREE.Vector3();
  const N = new THREE.Vector3();
  const q = new THREE.Quaternion();
  const mtx = new THREE.Matrix4();
  const one = new THREE.Vector3(1, 1, 1);
  let count = 0;
  for (const side of o.sides || [1, -1]) {
    for (let i = 0; i < n; i++) {
      const z = o.z0 + i * o.pitch;
      if (o.skip && o.skip.some((sz) => Math.abs(sz - z) < o.pitch * 0.5)) continue;
      const s = side * hull.angleAt(z, o.y);
      hull.point(z, s, P);
      hull.normal(z, s, N);
      P.addScaledVector(N, 0.006);
      // The pane lies in the skin: its +Z faces out along the normal, its
      // +Y points up the skin.
      const zAxis = N.clone();
      const xAxis = new THREE.Vector3(0, 1, 0).cross(zAxis).normalize();
      const yAxis = zAxis.clone().cross(xAxis).normalize();
      mtx.makeBasis(xAxis, yAxis, zAxis);
      q.setFromRotationMatrix(mtx);
      b.static.add(pane.clone(), b.m.glassDecal, new THREE.Matrix4().compose(P.clone(), q, one));
      count++;
    }
  }
  pane.dispose();
  return count;
}

/**
 * A door or hatch outline: a thin flat ribbon lying ON the skin, round a
 * closed loop of `corners` given as [dz, y] offsets from station z, on the
 * given side (+1 right, -1 left).
 *
 * The outlines were tubes through their corners only, so each edge was a
 * straight chord across a curved side. The Meridian's side bulges 0.1
 * between a door's sill and its top, which buried all but the top of every
 * door in the skin: from outside, a small dark bracket over nothing. Each
 * edge is now walked in steps and every step put back on the skin, and the
 * seam is a two-triangle-per-step ribbon rather than a tube — walking the
 * edges as tubes cost the Meridian 480 triangles for four doors.
 */
export function seamOnSkin(hull, z, side, corners, { width = 0.024, step = 0.15, lift = 0.006 } = {}) {
  const path = [];
  for (let i = 0; i < corners.length - 1; i++) {
    const a = corners[i];
    const c = corners[i + 1];
    const n = Math.max(1, Math.ceil(Math.hypot(c[0] - a[0], c[1] - a[1]) / step));
    for (let k = 0; k < n; k++) path.push([a[0] + ((c[0] - a[0]) * k) / n, a[1] + ((c[1] - a[1]) * k) / n]);
  }
  const P = [];
  const N = [];
  for (const [dz, y] of path) {
    const s = side * hull.angleAt(z + dz, y);
    const n = hull.normal(z + dz, s, new THREE.Vector3());
    P.push(hull.point(z + dz, s, new THREE.Vector3()).addScaledVector(n, lift));
    N.push(n);
  }
  const count = P.length;
  const pos = [];
  const T = new THREE.Vector3();
  const B = new THREE.Vector3();
  for (let i = 0; i < count; i++) {
    T.subVectors(P[(i + 1) % count], P[(i - 1 + count) % count]).normalize();
    B.crossVectors(N[i], T).normalize().multiplyScalar(width / 2);
    pos.push(P[i].x + B.x, P[i].y + B.y, P[i].z + B.z, P[i].x - B.x, P[i].y - B.y, P[i].z - B.z);
  }
  const idx = [];
  const face = new THREE.Vector3();
  const e1 = new THREE.Vector3();
  const e2 = new THREE.Vector3();
  const v = (k) => new THREE.Vector3(pos[k * 3], pos[k * 3 + 1], pos[k * 3 + 2]);
  for (let i = 0; i < count; i++) {
    const a = i * 2;
    const b = i * 2 + 1;
    const c = ((i + 1) % count) * 2;
    const d = c + 1;
    // Wind each quad so it faces out along the skin normal.
    face.crossVectors(e1.subVectors(v(b), v(a)), e2.subVectors(v(c), v(a)));
    if (face.dot(N[i]) >= 0) idx.push(a, b, c, b, d, c);
    else idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(new Array(count * 4).fill(0.5), 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** A flat rounded rectangle in the XY plane, facing +Z. */
function roundedRect(w, h, r, seg = 3) {
  const shape = new THREE.Shape();
  const x = -w / 2;
  const y = -h / 2;
  shape.moveTo(x + r, y);
  shape.lineTo(x + w - r, y);
  shape.quadraticCurveTo(x + w, y, x + w, y + r);
  shape.lineTo(x + w, y + h - r);
  shape.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  shape.lineTo(x + r, y + h);
  shape.quadraticCurveTo(x, y + h, x, y + h - r);
  shape.lineTo(x, y + r);
  shape.quadraticCurveTo(x, y, x + r, y);
  const g = new THREE.ShapeGeometry(shape, seg);
  return g;
}

/**
 * A turbofan nacelle on a pylon: cowl, inlet lip, a dark throat with the
 * fan and its spinner inside, the core and a nozzle that warms with power.
 * `at` is the centre of the nacelle's front face; it points along -Z.
 */
export function jetNacelle(b, { at, radius: r, length: L, pylonTo, pylonZ }) {
  const { m } = b;
  const [x, y, z] = at;
  const bat = b.static;
  const nac = m.nacelle || (m.nacelle = m.body);
  // Outer cowl: lip, fattest a third of the way back, then tapering.
  const outer = turned(
    [
      [r * 0.86, 0],
      [r * 0.97, 0.05],
      [r, 0.22],
      [r * 1.0, L * 0.4],
      [r * 0.9, L * 0.8],
      [r * 0.74, L],
    ],
    14
  );
  bat.place(outer, nac, { p: [x, y, z] });
  // Inside of the lip, turning in to the throat.
  const inner = turned([[r * 0.74, L * 0.3], [r * 0.86, 0]], 14);
  bat.place(inner, m.dark, { p: [x, y, z] });
  // Fan face and spinner.
  const fan = new THREE.CircleGeometry(r * 0.75, 14);
  bat.place(fan, m.grey, { p: [x, y, z + L * 0.3], r: [Math.PI, 0, 0] });
  bat.place(turned([[0, -0.2 * r], [r * 0.16, -0.08 * r], [r * 0.26, 0.08 * r]], 12, { closeEnds: true }), m.metal, { p: [x, y, z + L * 0.3] });
  // Core and exhaust plug, behind the cowl.
  const core = turned([[r * 0.66, 0], [r * 0.5, L * 0.3]], 14);
  if (!m.hot) {
    m.hot = new THREE.MeshStandardMaterial({ color: 0x3a3430, emissive: 0xff7020, emissiveIntensity: 0, roughness: 0.5, metalness: 0.5 });
    b.nozzles.push(m.hot);
  }
  bat.place(core, m.hot, { p: [x, y, z + L] });
  bat.place(turned([[r * 0.42, 0], [r * 0.3, L * 0.14], [0.001, L * 0.36]], 12, { closeEnds: true }), m.grey, { p: [x, y, z + L + L * 0.3] });
  // Pylon: a thin blade from the top of the cowl up into the wing.
  if (pylonTo !== undefined) {
    const z0 = pylonZ ? pylonZ[0] : z + L * 0.25;
    const z1 = pylonZ ? pylonZ[1] : z + L * 1.15;
    const h = pylonTo - (y + r * 0.85);
    const g = plainUV(new THREE.BoxGeometry(r * 0.22, h + 0.08, z1 - z0));
    // Taper the front edge so it is not a brick.
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      if (p.getZ(i) < 0 && p.getY(i) < 0) p.setZ(i, p.getZ(i) + (z1 - z0) * 0.25);
    }
    g.computeVertexNormals();
    bat.place(g, m.body, { p: [x, y + r * 0.85 + (h + 0.08) / 2 - 0.04, (z0 + z1) / 2] });
  }
}

/**
 * A skid at the tail, reaching down to the flight model's tail-strike point,
 * so that when the physics says the tail touched, the thing drawn there is
 * what touched.
 */
export function tailBumper(b, hull, z, y, len = 0.35) {
  const top0 = hull.botAt(z - len) + 0.03;
  const top1 = hull.botAt(z + len * 0.4) + 0.03;
  b.put(tubePath([[0, top0, z - len], [0, y + 0.025, z], [0, top1, z + len * 0.4]], 0.025, 6), b.m.metal);
}

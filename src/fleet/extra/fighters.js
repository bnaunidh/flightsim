/**
 * The jets from the wishlist: "Add (F-22 and F-35B) and other jets",
 * "Add a (F-18)", "Add Air Massimo and make it the fastest plane".
 *
 * Built the way the Vanguard and the Nightjar are (../aircraft-combat.js):
 * body stations lofted into a skin, a trapezoid wing, a tail, fins, a canopy,
 * gear, and a `decorate(ctx)` for everything a trapezoid cannot say. Metres,
 * -Z forward, +Y up, origin at the centre of gravity, so the physics' gear
 * points in ../../aircraft/extra/fighters.js are these same numbers.
 *
 * PROPORTIONS, measured off the built models (every triangle, flames and
 * decal cards left out) against the published figures:
 *
 *   f22      13.64 x 18.79 m  span:length .726   real 13.56 x 18.92  .717
 *   f35b     10.75 x 15.74 m  span:length .683   real 10.67 x 15.61  .684
 *   fa18     11.74 x 17.59 m  span:length .667   real 11.43 x 17.07  .670
 *   massimo   9.68 x 21.51 m  span:length .450   an original design
 *
 * The Hornet's real figure is the wing without wingtip missiles (12.31 m
 * with them); these carry empty rails, which is the 0.3 m over, and its
 * length includes a 0.5 m nose probe.
 *
 * (tests/features/fighters.mjs re-measures these from the triangles, so the
 * table cannot quietly go stale.) The planform was set first, from the real
 * leading- and trailing-edge sweeps: the F-22's 42 degree leading edge with a
 * 17 degree FORWARD-swept trailing edge is the diamond, and it is the single
 * thing that makes a Raptor read as a Raptor from three hundred metres.
 *
 * Everything else is the detail that reads from the chase camera, which is
 * where a ten-year-old actually looks at their aeroplane: from behind. So the
 * tails, the nozzles and the fins got the effort — twin canted fins on three
 * of them, the Raptor's flat vectoring nozzles, the Hornet's round ones with
 * petals, the F-35B's swivelling nozzle and lift-fan door, and a blue flame
 * on the fast one.
 */
import * as THREE from '../../vendor/three.module.js';
import { addInstanced } from '../common.js';

/* ------------------------------------------------------------------ *
 * Geometry helpers. All non-indexed with flat normals: these are hard-
 * edged shapes, and a shared vertex across a crease smears the shading.
 * ------------------------------------------------------------------ */

function own(ctx, name, geo, mat, parent) {
  ctx.model.userData.ownGeometry(geo);
  const m = new THREE.Mesh(geo, mat);
  m.name = name;
  m.castShadow = !mat.transparent;
  m.receiveShadow = true;
  parent.add(m);
  return m;
}

/** Positions to a flat-shaded geometry, with planar UVs so a mapped
 *  material never samples a missing attribute. */
function geometryFrom(pos) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  const uv = new Float32Array((pos.length / 3) * 2);
  for (let i = 0, j = 0; i < pos.length; i += 3, j += 2) {
    uv[j] = pos[i] * 0.12 + 0.5;
    uv[j + 1] = pos[i + 2] * 0.06 + 0.5;
  }
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  return g;
}

/** Push a triangle, turned so its normal points away from `inside`. */
function tri(pos, a, b, c, inside) {
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
  const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
  const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  const mx = (a[0] + b[0] + c[0]) / 3 - inside[0];
  const my = (a[1] + b[1] + c[1]) / 3 - inside[1];
  const mz = (a[2] + b[2] + c[2]) / 3 - inside[2];
  if (nx * mx + ny * my + nz * mz >= 0) pos.push(...a, ...b, ...c);
  else pos.push(...a, ...c, ...b);
}

/**
 * A flat plate with thickness from its outline, [[x, y, z], ...] around the
 * perimeter. The LEX, the chines, the canards, the lift-fan door. `axis` is
 * the direction the thickness runs: 1 (y) for a lying plate, 0 (x) for a
 * standing one such as a splitter.
 */
function plate(ctx, name, pts, thick, mat, parent, axis = 1) {
  const h = thick / 2;
  // The two in-plane axes, as indices into [x, y, z].
  const [u, v] = axis === 1 ? [0, 2] : [2, 1];
  const contour = pts.map((p) => new THREE.Vector2(p[u], p[v]));
  const faces = THREE.ShapeUtils.triangulateShape(contour, []);
  const pos = [];
  const c = [0, 0, 0];
  for (const p of pts) for (let i = 0; i < 3; i++) c[i] += p[i] / pts.length;
  const off = (p, d) => { const q = [p[0], p[1], p[2]]; q[axis] += d; return q; };
  const at = (p, d) => { const q = [...c]; q[u] = p[u]; q[v] = p[v]; q[axis] = p[axis] + d; return q; };
  for (const [a, b, k] of faces) {
    const A = pts[a], B = pts[b], C = pts[k];
    const mid = [(A[0] + B[0] + C[0]) / 3, (A[1] + B[1] + C[1]) / 3, (A[2] + B[2] + C[2]) / 3];
    tri(pos, off(A, h), off(B, h), off(C, h), at(mid, -1));
    tri(pos, off(A, -h), off(B, -h), off(C, -h), at(mid, 1));
  }
  for (let i = 0; i < pts.length; i++) {
    const A = pts[i], B = pts[(i + 1) % pts.length];
    const inside = [...c];
    inside[axis] = (A[axis] + B[axis]) / 2;
    tri(pos, off(A, -h), off(B, -h), off(B, h), inside);
    tri(pos, off(A, -h), off(B, h), off(A, h), inside);
  }
  return own(ctx, name, geometryFrom(pos), mat, parent);
}

/**
 * One four-cornered face that faces AWAY from `towards` (a direction from its
 * centre into whatever it covers). The intake mouths and nozzle petals:
 * single-sided, so which way they face is not a detail.
 */
function face(ctx, name, pts, towards, mat, parent) {
  const c = [0, 0, 0];
  for (const p of pts) for (let i = 0; i < 3; i++) c[i] += p[i] / pts.length;
  const inside = [c[0] + towards[0], c[1] + towards[1], c[2] + towards[2]];
  const pos = [];
  tri(pos, pts[0], pts[1], pts[2], inside);
  tri(pos, pts[0], pts[2], pts[3], inside);
  const m = own(ctx, name, geometryFrom(pos), mat, parent);
  m.castShadow = false;
  return m;
}

/**
 * A closed tube between four-cornered sections, each [[x,y,z] x 4] in the
 * same winding. Intake trunks, flat nozzles, rails. Capped at both ends.
 */
function boxLoft(ctx, name, sections, mat, parent, { capStart = true, capEnd = true } = {}) {
  const pos = [];
  const centre = (s) => [
    (s[0][0] + s[1][0] + s[2][0] + s[3][0]) / 4,
    (s[0][1] + s[1][1] + s[2][1] + s[3][1]) / 4,
    (s[0][2] + s[1][2] + s[2][2] + s[3][2]) / 4,
  ];
  for (let k = 0; k < sections.length - 1; k++) {
    const S = sections[k], T = sections[k + 1];
    const cS = centre(S), cT = centre(T);
    const inside = [(cS[0] + cT[0]) / 2, (cS[1] + cT[1]) / 2, (cS[2] + cT[2]) / 2];
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4;
      tri(pos, S[i], S[j], T[j], inside);
      tri(pos, S[i], T[j], T[i], inside);
    }
  }
  const cap = (S, towards) => {
    const c = centre(S);
    const inside = [c[0] + towards[0], c[1] + towards[1], c[2] + towards[2]];
    tri(pos, S[0], S[1], S[2], inside);
    tri(pos, S[0], S[2], S[3], inside);
  };
  if (sections.length > 1) {
    const a = centre(sections[0]), b = centre(sections[1]);
    const n = sections.length;
    const y = centre(sections[n - 2]), z = centre(sections[n - 1]);
    if (capStart) cap(sections[0], [b[0] - a[0], b[1] - a[1], b[2] - a[2]]);
    if (capEnd) cap(sections[n - 1], [y[0] - z[0], y[1] - z[1], y[2] - z[2]]);
  }
  return own(ctx, name, geometryFrom(pos), mat, parent);
}

/** A rectangle section centred on (x, y) at z, `w` wide and `h` tall. */
function rect(x, y, z, w, h) {
  return [[x - w / 2, y - h / 2, z], [x + w / 2, y - h / 2, z], [x + w / 2, y + h / 2, z], [x - w / 2, y + h / 2, z]];
}

/** A round lofted pipe along +Z at (x, y): [[z, r], ...]. */
function pipe(ctx, name, x, y, stations, mat, parent, radial = 12) {
  const m = ctx.skin(stations.map(([z, r, ry]) => [z, r, ry ?? r, y]), mat, parent, radial);
  m.name = name;
  m.position.x = x;
  return m;
}

/**
 * Cant the twin fins outward.
 *
 * The core builds a fin pair from `fin: { x, mirror: true }`, both upright,
 * each with its own hinged rudder. Three of these four have canted fins —
 * 28 degrees on the Raptor, 25 on the F-35, 20 on the Hornet — and upright
 * twin fins is the F-15, not any of them. So each fin and its rudder is moved
 * into a group that rotates about the fin's own root line. The rudder keeps
 * its hinge, now on the canted fin, and the core's rudder animation still
 * finds it.
 */
function cantFins(ctx, cantDeg) {
  const fin = ctx.parts.verticalFin;
  const f = ctx.config.fin;
  if (!fin || !f) return;
  const cant = THREE.MathUtils.degToRad(cantDeg);
  const box = new THREE.Box3();
  const sideOf = (o) => {
    if (o.isMesh) {
      o.geometry.computeBoundingBox();
      box.copy(o.geometry.boundingBox);
      return Math.sign((box.min.x + box.max.x) / 2);
    }
    return Math.sign(o.position.x);
  };
  const kids = [...fin.children];
  for (const s of [-1, 1]) {
    const mine = kids.filter((o) => sideOf(o) === s);
    if (!mine.length) continue;
    const g = new THREE.Group();
    g.name = s < 0 ? 'Port canted fin' : 'Starboard canted fin';
    fin.add(g);
    for (const o of mine) g.add(o);
    const px = s * Math.abs(f.x || 0), py = f.rootY;
    const th = -s * cant;
    const c = Math.cos(th), sn = Math.sin(th);
    g.rotation.z = th;
    g.position.set(px - (px * c - py * sn), py - (px * sn + py * c), 0);
  }
}

/** A hot nozzle face whose glow follows the engine. */
function hotMaterial(ctx) {
  return ctx.model.userData.ownMaterial(new THREE.MeshStandardMaterial({
    name: 'Aircraft_hot_nozzle', color: '#3b332c', emissive: '#e8863e', emissiveIntensity: 0, roughness: 0.62,
  }));
}

/**
 * The afterburner, seen from the chase camera.
 *
 * One additive cone per nozzle, shown only near full power. It is the most
 * asked-for thing about a fighter by anyone who is ten, and it costs one
 * draw each: no particles, no per-frame allocation — the animation only
 * writes a scale, an opacity and a visibility flag.
 */
function flame(ctx, name, parent, { x = 0, y = 0, z, r, length, color = '#ffb366', flatten = 1 }) {
  const mat = ctx.model.userData.ownMaterial(new THREE.MeshBasicMaterial({
    name: 'Aircraft_afterburner_flame', color, transparent: true, opacity: 0, depthWrite: false,
    blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false,
  }));
  const geo = new THREE.ConeGeometry(r, length, 12, 1, true);
  geo.rotateX(Math.PI / 2);
  geo.translate(0, 0, length / 2);
  const m = own(ctx, name, geo, mat, parent);
  m.castShadow = false;
  m.receiveShadow = false;
  m.position.set(x, y, z);
  m.scale.y = flatten;
  m.visible = false;
  const inner = own(ctx, name + ' core', geo.clone(), mat, parent);
  inner.castShadow = false;
  inner.receiveShadow = false;
  inner.position.set(x, y, z);
  inner.scale.set(0.55, 0.55 * flatten, 0.6);
  inner.visible = false;
  return { outer: m, inner, mat, flatten };
}

function driveFlames(ctx, flames, hot) {
  ctx.registerAnimation((dt, state) => {
    const rpm = state.rpm || 0;
    if (hot) hot.emissiveIntensity = Math.max(0, (rpm - 0.4) / 0.6) * 2.6;
    const k = Math.min(1, Math.max(0, (rpm - 0.86) / 0.12));
    const flick = 1 + Math.sin((state.time || 0) * 41) * 0.05 + Math.sin((state.time || 0) * 23) * 0.04;
    for (const f of flames) {
      const on = k > 0.01;
      f.outer.visible = on;
      f.inner.visible = on;
      if (!on) continue;
      f.mat.opacity = 0.5 * k;
      f.outer.scale.z = (0.55 + 0.45 * k) * flick;
      f.inner.scale.z = (0.4 + 0.3 * k) * flick;
    }
  });
}

/** Nozzle petals, as on the Vanguard: faceted, overlapping at the root. */
function petals(ctx, { x, y, z0, outerR, innerR, length, count = 10, parent }) {
  const m = ctx.materials;
  for (let i = 0; i < count; i++) {
    const a0 = (i / count) * Math.PI * 2;
    const a1 = ((i + 0.82) / count) * Math.PI * 2;
    const inset = (a1 - a0) * 0.22;
    const b0 = a0 + inset, b1 = a1 - inset;
    const am = (a0 + a1) / 2;
    face(ctx, `nozzle petal ${i + 1}`, [
      [x + Math.cos(a0) * outerR, y + Math.sin(a0) * outerR, z0],
      [x + Math.cos(a1) * outerR, y + Math.sin(a1) * outerR, z0],
      [x + Math.cos(b1) * innerR, y + Math.sin(b1) * innerR, z0 + length],
      [x + Math.cos(b0) * innerR, y + Math.sin(b0) * innerR, z0 + length],
    ], [-Math.cos(am), -Math.sin(am), 0], m.metal, parent);
  }
}

/** Mirror a list of points across the centreline. */
const mirror = (pts, s) => pts.map(([x, y, z]) => [x * s, y, z]);

/**
 * The Raptor carries its weapons inside, so what shows is the doors: two
 * long main-bay doors either side of the keel between the intakes, and a
 * short side-bay door low on each intake trunk, under the wing root. Their
 * ends come to a point, the saw-tooth edge a stealth door has. They are the
 * darker grey and sit 1.5 cm proud of the skin, which is what makes their
 * edges read as panel lines from underneath. One mesh for all four.
 *
 * The main doors lie on the octagon loft's two belly facets. Between two
 * body stations the loft runs straight from ring to ring, so each door
 * column gets a point at every station inside the door, not just at its
 * ends: a flat door spanning the kink at a station went into the skin.
 */
function weaponBays(ctx) {
  const body = ctx.config.body;
  const LIFT = 0.015;
  const ring = (z) => {
    let i = 0;
    while (i < body.length - 2 && body[i + 1][0] < z) i++;
    const a = body[i], b = body[i + 1];
    const t = Math.min(1, Math.max(0, (z - a[0]) / (b[0] - a[0])));
    return [a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, (a[3] || 0) + ((b[3] || 0) - (a[3] || 0)) * t];
  };
  // A point on the belly facet (keel to the 45-degree vertex), lifted off it.
  const belly = (x, z) => {
    const [rx, ry, cy] = ring(z);
    const s = x < 0 ? -1 : 1;
    const u = Math.abs(x) / (Math.SQRT1_2 * rx);
    const y = cy - ry + u * (1 - Math.SQRT1_2) * ry;
    const nx = (1 - Math.SQRT1_2) * ry, ny = -Math.SQRT1_2 * rx, nl = Math.hypot(nx, ny);
    return [x + (s * nx / nl) * LIFT, y + (ny / nl) * LIFT, z];
  };
  const stations = body.map((b) => b[0]);
  const pos = [];
  for (const s of [-1, 1]) {
    // Main door: three columns across, the middle one a tooth ahead of the
    // corners at both ends.
    const cols = [[0.06, -3.25, 0.75], [0.39, -3.55, 0.45], [0.72, -3.25, 0.75]];
    const inner = stations.filter((z) => z > -3.25 && z < 0.45);
    const grid = cols.map(([x, zf, zr]) => [zf, ...inner, zr].map((z) => belly(s * x, z)));
    for (let c = 0; c < grid.length - 1; c++) {
      for (let r = 0; r < grid[c].length - 1; r++) {
        const a = grid[c][r], b = grid[c + 1][r], cc = grid[c + 1][r + 1], d = grid[c][r + 1];
        const inside = [0, ring(a[2])[2], (a[2] + d[2]) / 2];
        tri(pos, a, b, cc, inside);
        tri(pos, a, cc, d, inside);
      }
    }
    // Side door, on the trunk's outer wall: it runs from x 1.82 at the mouth
    // to 1.78 at z -1.5. Leant back like the mouth in front of it.
    const wall = (y, z) => [s * (1.82 - 0.04 * Math.min(1, Math.max(0, (z + 4.6) / 3.1)) + LIFT), y, z];
    const q = [wall(-0.18, -4.05), wall(-0.54, -3.85), wall(-0.54, -1.95), wall(-0.18, -2.15)];
    const inside = [0, -0.36, -3.0];
    tri(pos, q[0], q[1], q[2], inside);
    tri(pos, q[0], q[2], q[3], inside);
  }
  const mesh = own(ctx, 'internal weapon bay doors', geometryFrom(pos), ctx.materials.accent, ctx.parts.fuselage);
  mesh.castShadow = false;
  return mesh;
}

/* ------------------------------------------------------------------ *
 * F-22 Raptor.
 *
 * Origin 10.75 m aft of the nose tip (27% of the mean chord). The body is
 * an OCTAGON loft on purpose: eight segments put a vertex on each side at
 * the centreline height, which is the Raptor's chine, and flat facets top
 * and bottom. A round loft here is the one change that stops it looking
 * like a stealth aeroplane.
 * ------------------------------------------------------------------ */
const f22 = {
  id: 'f22', name: 'F-22 Raptor', kind: 'fighter', massKg: 6400,
  paint: '#8e959c', accent: '#5b636b', registration: 'AF 22-01', bodySegments: 8,
  body: [
    [-10.75, 0.03, 0.03, -0.04], [-10.15, 0.30, 0.22, -0.04], [-9.15, 0.55, 0.42, -0.02],
    [-7.75, 0.78, 0.62, 0.02], [-6.25, 0.92, 0.76, 0.04], [-5.15, 1.0, 0.84, 0.0],
    [-4.35, 1.62, 0.94, -0.08], [-2.55, 1.74, 0.98, -0.1], [-0.25, 1.76, 0.9, -0.08],
    [2.25, 1.70, 0.76, -0.04], [4.45, 1.55, 0.6, 0], [5.85, 1.32, 0.48, 0], [6.55, 1.12, 0.4, 0],
  ],
  // 42 degree leading edge, trailing edge swept FORWARD 17 degrees: the diamond.
  wing: { rootX: 1.5, span: 5.28, rootZ: -2.775, rootY: 0.05, rootChord: 7.95, tipChord: 1.6, sweep: 4.755,
    dihedral: -0.28, thickness: 0.3, tipThickness: 0.05, flaps: true, struts: false },
  tail: { rootX: 1.3, span: 3.12, rootZ: 4.35, rootY: 0.02, rootChord: 3.3, tipChord: 0.9, sweep: 2.8, dihedral: 0, thickness: 0.14 },
  fin: { x: 1.55, rootZ: 1.45, rootY: 0.22, height: 3.05, rootChord: 3.9, tipChord: 1.45, sweep: 1.35, mirror: true, thickness: 0.16 },
  canopy: { kind: 'bubble', z0: -7.75, z1: -3.6, width: 0.52, height: 0.78, baseY: 0.62 },
  gear: { nose: [0, -1.72, -4.95], main: [1.6, -1.59, 1.1], noseRadius: 0.33, mainRadius: 0.46, retractable: true, dualMain: false, doors: true },
  engines: [],
  eye: [0, 1.02, -6.2], hook: false,
  decorate(ctx) {
    const { parts, materials: m, tube, box } = ctx;
    cantFins(ctx, 28);
    const hot = hotMaterial(ctx);
    const flames = [];
    for (const s of [-1, 1]) {
      const side = s < 0 ? 'left' : 'right';
      /*
       * Caret intakes. The mouth is a parallelogram leaning back — top lip
       * furthest forward, outer edge swept — because the Raptor's intake is
       * the other thing, after the diamond, that reads from the side.
       */
      const g = ctx.group(`${side}Intake`, `${side} caret intake`, 60, 'fuselage', parts.fuselage);
      const mouth = mirror([[1.0, 0.2, -5.25], [1.8, 0.1, -4.9], [1.8, -0.62, -4.45], [1.0, -0.62, -4.8]], s);
      face(ctx, `${side} intake mouth`, mouth, [0, 0, 1], m.dark, g);
      tube(`${side} intake upper lip`, mirror([[1.0, 0.2, -5.27]], s)[0], mirror([[1.82, 0.1, -4.92]], s)[0], 0.035, m.skin, g, 5);
      tube(`${side} intake outer lip`, mirror([[1.82, 0.1, -4.92]], s)[0], mirror([[1.82, -0.63, -4.47]], s)[0], 0.035, m.skin, g, 5);
      tube(`${side} intake lower lip`, mirror([[1.82, -0.63, -4.47]], s)[0], mirror([[1.0, -0.63, -4.82]], s)[0], 0.035, m.skin, g, 5);
      boxLoft(ctx, `${side} intake trunk`, [
        mirror([[1.0, -0.64, -4.8], [1.82, -0.64, -4.45], [1.82, 0.1, -4.9], [1.0, 0.2, -5.25]], s),
        mirror([[1.1, -0.66, -1.5], [1.78, -0.66, -1.5], [1.78, 0.34, -1.5], [1.1, 0.5, -1.5]], s),
      ], m.skin, g, { capStart: false });

      /*
       * Two-dimensional thrust-vectoring nozzles: flat, wider than they are
       * tall, with paddles top and bottom that follow the stick in pitch.
       */
      const eng = ctx.group(`${side}Engine`, `${side} engine and 2D nozzle`, 900, 'fuselage', parts.fuselage);
      const x = s * 0.62;
      boxLoft(ctx, `${side} nozzle fairing`, [
        rect(x, -0.02, 4.9, 1.12, 0.66), rect(x, -0.02, 6.1, 1.06, 0.6), rect(x, -0.02, 6.6, 1.0, 0.56),
      ], m.skin, eng, { capEnd: false });
      const exit = new THREE.Group();
      exit.name = `${side} vectoring nozzle`;
      exit.position.set(x, -0.02, 6.6);
      eng.add(exit);
      box(`${side} nozzle upper paddle`, [0.98, 0.06, 0.58], [0, 0.25, 0.26], m.metal, exit);
      box(`${side} nozzle lower paddle`, [0.98, 0.06, 0.58], [0, -0.25, 0.26], m.metal, exit);
      box(`${side} nozzle sidewall outer`, [0.05, 0.5, 0.42], [s * 0.48, 0, 0.18], m.metal, exit);
      box(`${side} nozzle sidewall inner`, [0.05, 0.5, 0.42], [-s * 0.48, 0, 0.18], m.metal, exit);
      box(`${side} nozzle throat`, [0.9, 0.42, 0.04], [0, 0, 0.1], hot, exit).castShadow = false;
      flames.push(flame(ctx, `${side} afterburner`, exit, { z: 0.12, r: 0.4, length: 3.2, flatten: 0.55 }));
      ctx.registerAnimation((dt, state) => {
        const want = -(state.pitch || 0) * 0.3;
        exit.rotation.x += (want - exit.rotation.x) * Math.min(1, dt * 8);
      });
      // Wing-root fillet, forward chine and a wingtip light fairing.
      tube(`${side} wingtip fairing`, [s * 6.72, -0.23, 1.95], [s * 6.72, -0.23, 3.5], 0.035, m.dark, parts[`${side}Wing`], 5);
    }
    weaponBays(ctx);
    // The "beaver tail" between the nozzles.
    plate(ctx, 'tail boom stinger', [[-0.16, 0, 5.4], [0.16, 0, 5.4], [0.1, 0, 7.15], [-0.1, 0, 7.15]], 0.18, m.skin, parts.tail);
    tube('nose air data probe', [0.35, -0.05, -9.2], [0.47, -0.05, -9.8], 0.012, m.metal, parts.nose, 4);
    driveFlames(ctx, flames, hot);
  },
  description: 'A wide, chined stealth fighter: diamond wing with a forward-swept trailing edge, caret intakes, twin fins canted out 28 degrees, all-moving stabilators, flat two-dimensional vectoring nozzles, and its weapons inside, behind saw-toothed bay doors.',
  inspiration: 'Proportioned against the published F-22A dimensions; procedurally built, not a licensed replica.',
};

/* ------------------------------------------------------------------ *
 * F/A-18 Hornet.
 *
 * Origin 10.4 m aft of the nose. Round, not faceted — it is a 1970s shape —
 * and it is the LEX that says Hornet: the big leading-edge extension that
 * runs from beside the windscreen out to the wing root.
 * ------------------------------------------------------------------ */
const fa18 = {
  id: 'fa18', name: 'F/A-18 Hornet', kind: 'naval', massKg: 6800,
  paint: '#9ba4ac', accent: '#5f6a74', registration: 'NH 300', bodySegments: 12,
  body: [
    [-10.4, 0.03, 0.03, -0.12], [-9.7, 0.27, 0.26, -0.1], [-8.6, 0.46, 0.46, -0.04], [-7.2, 0.6, 0.62, 0.03],
    [-5.6, 0.62, 0.74, 0.06], [-4.1, 0.66, 0.76, 0.04], [-2.6, 0.8, 0.74, 0], [-0.4, 1.1, 0.7, 0],
    [2.1, 1.18, 0.62, 0], [4.2, 1.12, 0.52, 0], [5.6, 1.04, 0.45, 0], [6.2, 0.98, 0.42, 0],
  ],
  wing: { rootX: 1.0, span: 4.715, rootZ: -1.65, rootY: -0.02, rootChord: 4.27, tipChord: 1.69, sweep: 2.37,
    dihedral: -0.24, thickness: 0.24, tipThickness: 0.06, flaps: true, struts: false },
  tail: { rootX: 0.95, span: 2.35, rootZ: 3.3, rootY: -0.05, rootChord: 2.6, tipChord: 1.0, sweep: 2.1, dihedral: -0.1, thickness: 0.12 },
  fin: { x: 1.0, rootZ: 0.2, rootY: 0.42, height: 2.65, rootChord: 3.3, tipChord: 1.25, sweep: 2.0, mirror: true, thickness: 0.15 },
  canopy: { kind: 'bubble', z0: -7.1, z1: -4.0, width: 0.5, height: 0.64, baseY: 0.55 },
  gear: { nose: [0, -1.44, -4.5], main: [1.55, -1.32, 0.9], noseRadius: 0.28, mainRadius: 0.4, retractable: true, dualMain: false, doors: true },
  engines: [
    { id: 'leftEngine', kind: 'jet', buried: true, x: -0.58, y: -0.02, z: 5.7, radius: 0.44, length: 1.9, afterburner: true, dependsOn: 'fuselage' },
    { id: 'rightEngine', kind: 'jet', buried: true, x: 0.58, y: -0.02, z: 5.7, radius: 0.44, length: 1.9, afterburner: true, dependsOn: 'fuselage' },
  ],
  eye: [0, 0.98, -5.9], hook: true,
  decorate(ctx) {
    const { parts, materials: m, tube, box } = ctx;
    cantFins(ctx, 20);
    const flames = [];
    for (const s of [-1, 1]) {
      const side = s < 0 ? 'left' : 'right';
      const wing = parts[`${side}Wing`];
      /*
       * The LEX. Thin, flat, and big: from the windscreen to the wing root,
       * widening all the way, meeting the leading edge 2 m out.
       */
      plate(ctx, `${side} leading-edge extension`, mirror([
        [0.52, 0.24, -7.1], [0.95, 0.22, -5.5], [1.35, 0.16, -4.0], [1.72, 0.08, -2.55],
        [2.12, -0.05, -1.1], [0.95, 0.0, -0.8], [0.5, 0.2, -5.8],
      ], s), 0.08, m.wing, wing);
      // D-shaped intakes tucked under the LEX, with their splitter plates.
      const g = ctx.group(`${side}Intake`, `${side} intake under the LEX`, 50, 'fuselage', parts.fuselage);
      boxLoft(ctx, `${side} intake trunk`, [
        mirror([[0.9, -0.74, -3.15], [1.46, -0.7, -3.15], [1.46, -0.1, -3.2], [0.9, -0.08, -3.2]], s),
        mirror([[0.95, -0.72, -0.8], [1.3, -0.7, -0.8], [1.3, -0.12, -0.8], [0.95, -0.1, -0.8]], s),
      ], m.skin, g, { capStart: false });
      const mouth = mirror([[0.93, -0.7, -3.17], [1.43, -0.67, -3.17], [1.43, -0.13, -3.22], [0.93, -0.11, -3.22]], s);
      face(ctx, `${side} intake mouth`, mouth, [0, 0, 1], m.dark, g);
      plate(ctx, `${side} splitter plate`, mirror([[0.88, -0.1, -3.45], [0.88, -0.74, -3.4], [0.88, -0.74, -2.6], [0.88, -0.1, -2.6]], s), 0.03, m.metal, g, 0);
      // Wingtip launch rails: they are what takes the span to 12.31 m.
      boxLoft(ctx, `${side} wingtip rail`, [
        rect(s * 5.8, -0.27, -0.4, 0.05, 0.05), rect(s * 5.8, -0.27, 0.0, 0.14, 0.14), rect(s * 5.8, -0.27, 2.6, 0.14, 0.14),
      ], m.skin, wing);
      // Afterburner petals and flames on both nozzles.
      const e = ctx.config.engines[s < 0 ? 0 : 1];
      const eg = parts[e.id];
      petals(ctx, { x: e.x, y: e.y, z0: e.z + e.length * 0.46, outerR: e.radius * 0.92, innerR: e.radius * 0.62, length: e.radius * 0.5, parent: eg });
      flames.push(flame(ctx, `${side} afterburner`, eg, { x: e.x, y: e.y, z: e.z + e.length * 0.5, r: e.radius * 0.7, length: 3.0 }));
    }
    // A second nose wheel beside the first, and the catapult launch bar.
    const ng = parts.noseGear;
    const roll = ng && ng.getObjectByName('Rolling wheels');
    const tyres = roll && roll.children.find((o) => o.isInstancedMesh);
    if (tyres) {
      const r = ctx.config.gear.noseRadius;
      const mat = new THREE.Matrix4();
      tyres.getMatrixAt(0, mat);
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, Math.PI / 2));
      tyres.setMatrixAt(0, new THREE.Matrix4().compose(new THREE.Vector3(-r * 0.5, 0, 0), q, new THREE.Vector3(1, 1, 1)));
      tyres.instanceMatrix.needsUpdate = true;
      addInstanced(ctx.model, roll, 'Tyres and hubs', tyres.geometry.clone(), tyres.material,
        [new THREE.Matrix4().compose(new THREE.Vector3(r * 0.5, 0, 0), q, new THREE.Vector3(1, 1, 1))]);
    }
    /*
     * The hook, moved up and aft so it clears the runway with the gear down.
     * The core hangs it at y -0.42 with a 1.34 m shank, which put the shoe
     * 4 cm UNDER the tarmac on an aeroplane this low — drawn through the
     * runway on every take-off.
     */
    const hook = parts.arrestorHook;
    if (hook) {
      hook.position.set(0, -0.2, 4.3);
      /*
       * And stowed on the ground. The core lowers it with the wheels, which
       * is right on the approach to the deck and wrong everywhere else: it
       * dragged 18 cm over the runway on every take-off roll. Down only when
       * the gear is down AND the wheels are off the ground; this runs after
       * the core's own surface animation, so it has the last word.
       */
      let down = 0;
      ctx.registerAnimation((dt, state) => {
        // The hook handle when the pilot has one (carrier ops); otherwise down with the gear in the air.
        const want = state.hookSet ? (state.hook ? 1 : 0) : (state.gear || 0) > 0.5 && !state.onGround ? 1 : 0;
        down += (want - down) * Math.min(1, dt * 3);
        hook.rotation.x = -1.1 * (1 - down);
      });
    }
    box('dorsal avionics hump', [0.42, 0.12, 1.6], [0, 0.72, -3.4], m.skin, parts.fuselage);
    tube('nose air data probe', [0, -0.1, -10.3], [0, -0.1, -10.8], 0.012, m.metal, parts.nose, 4);
    driveFlames(ctx, flames, null);
  },
  description: 'A twin-engine naval fighter: round nose, large leading-edge extensions from the windscreen to the wing, D-shaped intakes under them, twin fins canted out 20 degrees, wingtip rails and an arrestor hook.',
  inspiration: 'Proportioned against the published F/A-18C dimensions; procedurally built, not a licensed replica.',
};

/* ------------------------------------------------------------------ *
 * F-35B Lightning II.
 *
 * Origin 9.15 m aft of the nose. Chunkier than the Raptor — the F-35's deep
 * body is the lift fan and the fuel — and octagonal for the same reason. The
 * STOVL hardware is real geometry with real hinges: the lift-fan door behind
 * the canopy, the fan under it, and the swivelling tailpipe. None of it
 * moves until src/features/stovl.js says so, through `userData.stovlRig` on
 * this model, so the F-35Bs parked on the apron keep their doors shut.
 * ------------------------------------------------------------------ */
const f35b = {
  id: 'f35b', name: 'F-35B Lightning II', kind: 'fighter', massKg: 6500,
  paint: '#6e757c', accent: '#484e55', registration: 'VM 35', bodySegments: 8,
  body: [
    [-9.15, 0.03, 0.03, -0.04], [-8.55, 0.3, 0.24, -0.04], [-7.55, 0.55, 0.46, -0.02], [-6.35, 0.74, 0.64, 0.02],
    [-4.85, 0.86, 0.78, 0.04], [-3.85, 1.05, 0.86, 0.0], [-2.95, 1.45, 0.92, -0.06], [-1.15, 1.55, 0.94, -0.06],
    [0.85, 1.55, 0.86, -0.04], [2.85, 1.42, 0.72, 0], [4.45, 1.1, 0.6, 0.02], [5.25, 0.8, 0.62, 0],
  ],
  wing: { rootX: 1.3, span: 4.035, rootZ: -1.835, rootY: 0, rootChord: 5.29, tipChord: 1.46, sweep: 2.82,
    dihedral: -0.18, thickness: 0.28, tipThickness: 0.06, flaps: true, struts: false },
  tail: { rootX: 1.05, span: 2.35, rootZ: 3.15, rootY: 0.02, rootChord: 2.7, tipChord: 1.0, sweep: 1.95, dihedral: 0, thickness: 0.12 },
  fin: { x: 1.2, rootZ: 1.75, rootY: 0.42, height: 2.35, rootChord: 2.8, tipChord: 1.15, sweep: 1.6, mirror: true, thickness: 0.15 },
  canopy: { kind: 'bubble', z0: -6.6, z1: -3.6, width: 0.5, height: 0.72, baseY: 0.62 },
  gear: { nose: [0, -1.48, -4.55], main: [1.45, -1.36, 0.85], noseRadius: 0.3, mainRadius: 0.42, retractable: true, dualMain: false, doors: true },
  engines: [],
  eye: [0, 1.02, -5.45], hook: false,
  decorate(ctx) {
    const { parts, materials: m, tube, box } = ctx;
    cantFins(ctx, 25);
    const rig = { nozzle: 0, doors: 0 };
    ctx.model.userData.stovlRig = rig;
    for (const s of [-1, 1]) {
      const side = s < 0 ? 'left' : 'right';
      // Diverterless intakes: a bump on the fuselage and a swept mouth.
      const g = ctx.group(`${side}Intake`, `${side} diverterless intake`, 50, 'fuselage', parts.fuselage);
      // Slanted outer wall, so it blends into the chine rather than standing
      // off the side of the body as a box.
      boxLoft(ctx, `${side} intake trunk`, [
        mirror([[0.9, -0.62, -4.1], [1.42, -0.56, -3.8], [1.22, 0.12, -4.2], [0.92, 0.26, -4.55]], s),
        mirror([[1.0, -0.64, -1.6], [1.5, -0.6, -1.6], [1.34, 0.2, -1.6], [1.0, 0.44, -1.6]], s),
      ], m.skin, g, { capStart: false });
      const mouth = mirror([[0.94, 0.24, -4.57], [1.24, 0.1, -4.22], [1.44, -0.55, -3.82], [0.92, -0.61, -4.12]], s);
      face(ctx, `${side} intake mouth`, mouth, [0, 0, 1], m.dark, g);
      const bump = new THREE.SphereGeometry(1, 8, 5, 0, Math.PI);
      bump.rotateY(s < 0 ? Math.PI : 0);
      bump.scale(0.18, 0.28, 0.6);
      own(ctx, `${side} DSI bump`, bump, m.skin, g).position.set(s * 0.86, -0.12, -4.65);
      tube(`${side} wingtip light`, [s * 5.3, -0.18, 0.95], [s * 5.3, -0.18, 1.9], 0.03, m.dark, parts[`${side}Wing`], 5);
    }
    /*
     * The lift fan and its door. The door is hinged at its BACK edge and
     * swings up and forward, which is how the real one opens — it is also
     * the thing people point at when an F-35B hovers.
     */
    const fanBay = ctx.group('liftFan', 'Lift fan and doors', 400, 'fuselage', parts.fuselage);
    /*
     * The F-35's broad flat back, from the canopy to between the fins. An
     * octagon loft peaks along the centreline, and a door laid on a peak
     * floats at its edges; this is the deck the door and the fan sit in.
     */
    boxLoft(ctx, 'dorsal deck', [
      [[-0.55, 0.62, -3.75], [0.55, 0.62, -3.75], [0.38, 0.9, -3.6], [-0.38, 0.9, -3.6]],
      [[-0.8, 0.62, -2.9], [0.8, 0.62, -2.9], [0.62, 0.97, -2.9], [-0.62, 0.97, -2.9]],
      [[-0.85, 0.6, 1.2], [0.85, 0.6, 1.2], [0.62, 0.94, 1.2], [-0.62, 0.94, 1.2]],
      [[-0.6, 0.5, 4.2], [0.6, 0.5, 4.2], [0.3, 0.66, 4.4], [-0.3, 0.66, 4.4]],
    ], m.skin, parts.fuselage);
    const fan = new THREE.CircleGeometry(0.5, 16);
    fan.rotateX(-Math.PI / 2);
    own(ctx, 'lift fan face', fan, m.dark, fanBay).position.set(0, 0.975, -2.35);
    const blades = [];
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI;
      blades.push(new THREE.Matrix4().compose(new THREE.Vector3(0, 0, 0),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(0, a, 0)), new THREE.Vector3(1, 1, 1)));
    }
    const hub = new THREE.Group();
    hub.name = 'Spinning lift fan';
    hub.position.set(0, 0.982, -2.35);
    fanBay.add(hub);
    addInstanced(ctx.model, hub, 'Lift fan blades', new THREE.BoxGeometry(0.94, 0.01, 0.07), m.metal, blades);
    const door = new THREE.Group();
    door.name = 'Lift fan door';
    door.position.set(0, 0.99, -1.45);
    fanBay.add(door);
    plate(ctx, 'lift fan door panel', [[-0.6, 0.0, -1.5], [0.6, 0.0, -1.5], [0.6, 0.0, 0], [-0.6, 0.0, 0]], 0.05, m.skin, door);
    const aux = [];
    for (const s of [-1, 1]) {
      const d = new THREE.Group();
      d.name = s < 0 ? 'Port auxiliary inlet door' : 'Starboard auxiliary inlet door';
      d.position.set(s * 0.6, 0.97, -1.2);
      fanBay.add(d);
      plate(ctx, 'auxiliary inlet door', [[0, 0.0, 0.1], [-s * 0.5, 0.0, 0.1], [-s * 0.5, 0.0, 0.75], [0, 0.0, 0.75]], 0.04, m.skin, d);
      aux.push({ d, s });
    }
    /*
     * The three-bearing swivel nozzle. One group pivoting at the back of the
     * body; `rig.nozzle` 0 is straight aft, 1 is straight down.
     */
    const eng = ctx.group('engine', 'Engine and swivel nozzle', 1200, 'fuselage', parts.fuselage);
    const swivel = new THREE.Group();
    swivel.name = 'Swivel nozzle';
    swivel.position.set(0, 0, 5.05);
    eng.add(swivel);
    pipe(ctx, 'swivel nozzle duct', 0, 0, [[-0.15, 0.7, 0.66], [0.45, 0.66, 0.62], [0.95, 0.6, 0.57], [1.41, 0.55, 0.52]], m.metal, swivel, 12);
    const hot = hotMaterial(ctx);
    const throat = new THREE.CircleGeometry(0.5, 12);
    own(ctx, 'nozzle throat', throat, hot, swivel).position.set(0, 0, 1.4);
    petals(ctx, { x: 0, y: 0, z0: 1.3, outerR: 0.55, innerR: 0.42, length: 0.24, count: 12, parent: swivel });
    const flames = [flame(ctx, 'afterburner', swivel, { z: 1.45, r: 0.44, length: 3.4 })];
    ctx.registerAnimation((dt, state) => {
      const k = Math.min(1, dt * 3);
      swivel.rotation.x += (rig.nozzle * Math.PI * 0.5 - swivel.rotation.x) * k;
      door.rotation.x += (rig.doors * 1.15 - door.rotation.x) * k;
      for (const { d, s } of aux) d.rotation.z += (-s * rig.doors * 0.9 - d.rotation.z) * k;
      hub.visible = door.rotation.x > 0.05;
      if (hub.visible) hub.rotation.y += (state.rpm || 0) * 60 * dt;
    });
    // Roll-post outlets under each wing: the other half of how it balances.
    for (const s of [-1, 1]) {
      box('roll post outlet', [0.34, 0.03, 0.22], [s * 3.1, -0.21, 0.5], m.dark, parts[s < 0 ? 'leftWing' : 'rightWing']);
    }
    driveFlames(ctx, flames, hot);
  },
  description: 'A single-engine STOVL fighter: chined nose, diverterless intakes, trapezoid wing, twin fins canted 25 degrees, a lift-fan door behind the canopy and a nozzle that swivels straight down.',
  inspiration: 'Proportioned against the published F-35B dimensions; procedurally built, not a licensed replica.',
};

/* ------------------------------------------------------------------ *
 * Air Massimo.
 *
 * An original design, asked for by name: "make it the fastest plane". So it
 * is shaped like speed and nothing else — a 21 m needle with a cranked arrow
 * wing blended in by chines, canards, two small fins canted out, a ventral
 * inlet and a blue flame. Span over length is .457, less than two thirds of
 * any fighter here, which is what "long and pointy" means in numbers and is
 * how it tells itself apart from the other three at any distance.
 *
 * The livery is the only one in the set that is not grey: pearl white, a red
 * nose and red chines, and its own name down the side.
 * ------------------------------------------------------------------ */
const massimo = {
  id: 'massimo', name: 'Air Massimo', kind: 'racer', massKg: 5200,
  paint: '#f3f4f6', accent: '#e0262b', registration: 'AIR MASSIMO', bodySegments: 12,
  body: [
    [-12.6, 0.02, 0.02, -0.05], [-11.6, 0.2, 0.16, -0.04], [-10.0, 0.42, 0.34, 0], [-8.2, 0.58, 0.5, 0.05],
    [-6.4, 0.66, 0.62, 0.08], [-4.4, 0.78, 0.66, 0.05], [-2.1, 0.92, 0.64, 0], [0.4, 1.0, 0.6, 0],
    [2.9, 1.0, 0.55, 0], [5.2, 0.95, 0.48, 0], [7.0, 0.85, 0.42, 0], [7.8, 0.75, 0.38, 0],
  ],
  wing: { rootX: 0.8, span: 4.0, rootZ: -4.0, rootY: -0.12, rootChord: 8.4, tipChord: 2.1, sweep: 6.3,
    dihedral: -0.05, thickness: 0.32, tipThickness: 0.05, flaps: true, struts: false },
  tail: null,
  fin: { x: 0.9, rootZ: 2.1, rootY: 0.35, height: 2.1, rootChord: 3.6, tipChord: 1.0, sweep: 2.4, mirror: true, thickness: 0.14 },
  canopy: { kind: 'bubble', z0: -8.3, z1: -4.6, width: 0.44, height: 0.5, baseY: 0.5 },
  gear: { nose: [0, -1.82, -5.6], main: [1.4, -1.72, 1.4], noseRadius: 0.28, mainRadius: 0.38, retractable: true, dualMain: false, doors: true },
  engines: [
    { id: 'leftEngine', kind: 'jet', buried: true, x: -0.48, y: -0.04, z: 7.3, radius: 0.4, length: 1.8, afterburner: true, dependsOn: 'fuselage' },
    { id: 'rightEngine', kind: 'jet', buried: true, x: 0.48, y: -0.04, z: 7.3, radius: 0.4, length: 1.8, afterburner: true, dependsOn: 'fuselage' },
  ],
  eye: [0, 0.85, -6.8], hook: false,
  decorate(ctx) {
    const { parts, materials: m, tube, box } = ctx;
    cantFins(ctx, 18);
    const flames = [];
    for (const s of [-1, 1]) {
      const side = s < 0 ? 'left' : 'right';
      const wing = parts[`${side}Wing`];
      // Red chines from the nose to the wing: the second, inner delta.
      plate(ctx, `${side} chine`, mirror([
        [0.3, -0.04, -10.2], [0.62, -0.05, -7.6], [0.95, -0.07, -5.4], [1.3, -0.1, -3.25],
        [1.42, -0.11, -2.9], [0.8, -0.1, -2.6], [0.4, -0.05, -8.6],
      ], s), 0.07, m.accent, wing);
      // Canards, in the accent too.
      plate(ctx, `${side} canard`, mirror([[0.6, 0.14, -6.2], [1.75, 0.16, -5.15], [1.75, 0.16, -4.85], [0.6, 0.14, -4.9]], s), 0.06, m.accent, parts.fuselage);
      // Red wing tips.
      plate(ctx, `${side} wing tip band`, mirror([[4.55, -0.16, 1.9], [4.83, -0.17, 2.34], [4.83, -0.17, 4.42], [4.55, -0.16, 4.42]], s), 0.07, m.accent, wing);
      const e = ctx.config.engines[s < 0 ? 0 : 1];
      const eg = parts[e.id];
      petals(ctx, { x: e.x, y: e.y, z0: e.z + e.length * 0.46, outerR: e.radius * 0.92, innerR: e.radius * 0.66, length: e.radius * 0.45, parent: eg });
      // A blue flame. Of course it is.
      flames.push(flame(ctx, `${side} afterburner`, eg, { x: e.x, y: e.y, z: e.z + e.length * 0.5, r: e.radius * 0.72, length: 4.2, color: '#7fd4ff' }));
    }
    // Red nose cone, the length of the radome, standing just proud of the skin.
    const nose = ctx.skin([[-12.62, 0.03, 0.03, -0.05], [-11.6, 0.215, 0.175, -0.04], [-10.4, 0.385, 0.315, -0.01]], m.accent, parts.nose, 12);
    nose.name = 'red nose cone';
    // Ventral inlet: a wide, shallow box under the belly with a ramp.
    boxLoft(ctx, 'ventral inlet', [
      [[-0.78, -0.86, -2.4], [0.78, -0.86, -2.4], [0.78, -0.52, -2.7], [-0.78, -0.52, -2.7]],
      [[-0.8, -0.9, 0.2], [0.8, -0.9, 0.2], [0.8, -0.45, 0.2], [-0.8, -0.45, 0.2]],
      [[-0.7, -0.72, 3.6], [0.7, -0.72, 3.6], [0.7, -0.42, 3.6], [-0.7, -0.42, 3.6]],
    ], m.skin, parts.fuselage, { capStart: false });
    face(ctx, 'ventral inlet mouth', [[0.76, -0.84, -2.42], [-0.76, -0.84, -2.42], [-0.76, -0.54, -2.68], [0.76, -0.54, -2.68]], [0, 0, 1], m.dark, parts.fuselage);
    box('dorsal racing stripe', [0.26, 0.03, 9.5], [0, 0.62, 1.8], m.accent, parts.fuselage);
    tube('nose probe', [0, -0.05, -12.55], [0, -0.05, -13.2], 0.014, m.metal, parts.nose, 4);
    driveFlames(ctx, flames, null);
  },
  description: 'An original hypersonic racer: a 21 m needle body, cranked arrow wing blended in by chines, canards, twin small canted fins, a ventral inlet, two afterburning engines and a blue flame.',
  inspiration: 'Original design for this game. Not based on any real aircraft.',
};

export const DEFINITIONS = [f22, fa18, f35b, massimo];
/** Every one of them is drawn by the pack: model.js has no twin canted fins. */
export const DRAWS = DEFINITIONS.map((d) => d.id);

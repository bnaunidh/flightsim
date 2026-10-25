/**
 * The window-frame hook: a cockpit interior cut to the exterior's own glass.
 *
 * From the seat, the outside of the aeroplane is invisible — every face of the
 * fuselage is culled from inside it — so what frames the view is whatever the
 * cockpit draws. The old cockpit drew a box with a gap in each wall, the same
 * box in every aeroplane, so its posts and sills were nowhere near the
 * windows the aeroplane actually has: from outside the Skylark has a
 * wrap-round windscreen meeting door posts and a rear window behind the wing,
 * and from inside it had two rectangles.
 *
 * This file builds the inside of the fuselage from the SAME description the
 * outside was lofted from: civil-kit.js hull() — the superellipse stations
 * and the named lines the window glass was cut along. The interior skin is
 * that surface moved inward by the skin's thickness, with the window openings
 * cut on exactly those lines (the grid follows them, so the edges are clean,
 * not stair-stepped), a dark frame band round every opening, the reveal (the
 * thickness of the skin, inner edge to the glass) and glass panes for the
 * rain to run down. So a window frame seen from the seat is where the window
 * is drawn outside, by construction, in every aeroplane that has a hull.
 *
 * glazingOf() finds that description for the model actually being flown:
 *   1. the civil hull (model.userData.cabinHull, set in model.js), or
 *   2. the fleet pack's canopy box ({ kind, z0, z1, width, height, baseY }),
 *      turned into a hull with the same glass, or
 *   3. a plain light-aircraft cabin round the eye, if there is neither.
 *
 * Everything here is in the MODEL's own units and frame; a builder puts the
 * result in space.exteriorGroup() (space.js) and it lands on the exterior.
 */

import * as THREE from '../../vendor/three.module.js';
import { clamp, lerp } from '../../core/noise.js';
import { hull as loftHull } from '../models/civil-kit.js';

/* ------------------------------------------------------------------ *
 * Finding the glass
 * ------------------------------------------------------------------ */

/**
 * The exterior glazing to match, for this type and model, in model units:
 * `{ source: 'hull' | 'pack' | 'default', hull, lines, windows }` where
 * hull is a civil-kit hull (point/normal/section/halfWidthAt...), lines maps
 * a line name to s(z), and windows are { z0, z1, from, to, side }.
 */
export function glazingOf(type, model, space) {
  const h = model && model.userData && model.userData.cabinHull;
  if (h && h.glazing && typeof h.point === 'function') {
    return { source: 'hull', hull: h, lines: h.glazing.lines, windows: h.glazing.windows };
  }
  const cfg = model && model.userData && model.userData.config;
  const q = cfg && cfg.canopy;
  if (q && typeof q.z0 === 'number') return packGlazing(q, space);
  return defaultGlazing(type, space);
}

/**
 * The fleet pack's canopy is a glass half-ellipsoid on the fuselage (see
 * fleet/aircraft-core.js): x * width, y * height + baseY over z0..z1. Here it
 * becomes a hull of that section with everything above the base glazed —
 * which is what the pack draws — and a cabin below it down to the floor.
 */
function packGlazing(q, space) {
  const len = q.z1 - q.z0;
  const mid = (q.z0 + q.z1) / 2;
  const floor = (space && space.eye ? space.eye[1] : q.baseY + 0.3) - 1.25;
  const stations = [];
  for (let i = 0; i <= 8; i++) {
    const f = i / 8;
    const z = q.z0 - 0.15 * len + f * 1.3 * len;
    const e = clamp(1 - Math.pow((z - mid) / (len * 0.58), 2), 0.05, 1);
    stations.push({ z, w: q.width * Math.max(0.55, Math.sqrt(e)), top: q.baseY + q.height * Math.sqrt(e), bot: floor, yc: q.baseY, nT: 2, nB: 3.2 });
  }
  const belt = Math.PI / 2 - 0.02;
  const h = loftHull({
    stations,
    radial: 10,
    maxStep: 0.3,
    lines: { belt },
    windows: [{ z0: q.z0 + len * 0.02, z1: q.z1 - len * 0.02, from: 'top', to: 'belt' }],
  });
  return { source: 'pack', hull: h, lines: h.glazing.lines, windows: h.glazing.windows };
}

/** A plain high-wing cabin round the eye, for a model that says nothing. */
function defaultGlazing(type, space) {
  const e = space ? space.eye.map((v) => v / space.k) : [-0.24, 0.46, 0.06];
  const z = e[2];
  const st = [
    { z: z - 1.15, w: 0.53, top: e[1] - 0.16, bot: e[1] - 1.0, yc: e[1] - 0.5, nT: 2.5, nB: 2.8 },
    { z: z - 0.6, w: 0.56, top: e[1] + 0.26, bot: e[1] - 1.02, yc: e[1] - 0.42, nT: 4, nB: 3 },
    { z: z + 1.4, w: 0.55, top: e[1] + 0.27, bot: e[1] - 1.0, yc: e[1] - 0.42, nT: 5, nB: 3 },
    { z: z + 1.9, w: 0.45, top: e[1] + 0.1, bot: e[1] - 0.9, yc: e[1] - 0.4, nT: 3, nB: 3 },
  ];
  const h = loftHull({
    stations: st,
    radial: 10,
    maxStep: 0.3,
    lines: { ctr: 0.045, ws: 1.02, roof: 0.5, belt: 1.5 },
    windows: [
      { z0: z - 1.05, z1: z - 0.52, from: 'ctr', to: 'ws' },
      { z0: z - 0.46, z1: z + 0.24, from: 'roof', to: 'belt' },
    ],
  });
  return { source: 'default', hull: h, lines: h.glazing.lines, windows: h.glazing.windows };
}

/** s(z) of a named line; 'top' and 'bottom' are the centrelines. */
export function lineAt(glazing, name, z) {
  if (name === 'top') return 0;
  if (name === 'bottom') return Math.PI;
  const f = glazing.lines[name];
  if (!f) throw new Error(`glazing has no line "${name}"`);
  return clamp(f(z), 0, Math.PI);
}

/**
 * The windscreen: the most forward window that reaches the top centreline
 * (or its centre strip). Everything else glazed is a side window.
 */
export function windscreenOf(glazing) {
  let best = null;
  for (const w of glazing.windows) {
    const s0 = Math.min(lineAt(glazing, w.from, (w.z0 + w.z1) / 2), lineAt(glazing, w.to, (w.z0 + w.z1) / 2));
    if (s0 > 0.2) continue;
    if (!best || w.z0 < best.z0) best = w;
  }
  return best;
}

/* ------------------------------------------------------------------ *
 * The interior skin
 * ------------------------------------------------------------------ */

/**
 * Build the inside of the cabin between two stations.
 *
 * opts (model units unless noted):
 *   z0, z1        front and back stations (bulkheads are capped there)
 *   inset         skin thickness: how far inside the outer skin the trim is
 *   frame         width of the frame band round each opening (arc length)
 *   frameZ        the same band's width fore and aft
 *   maxStep       longest gap between rings
 *   radial        samples per half-section between lines
 *   colourAt(p, s, z) -> THREE.Color   trim colour at an inner-skin point
 *   materials     { wall, frame, glass, cap }  (wall uses vertex colours)
 *   windows       optional filter (w, i) => bool for which openings to cut
 *
 * Returns { group, meshes: { wall, frame, glass, front, back }, openings,
 *           sill(sideSign) -> [{x, y, z}] , insetPoint(z, s) }.
 */
export function interiorShell(glazing, opts) {
  const h = glazing.hull;
  const {
    z0: zA,
    z1: zB,
    inset = 0.035,
    frame = 0.035,
    frameZ = frame,
    maxStep = 0.07,
    radial = 30,
    colourAt = () => new THREE.Color(0x8a8f96),
    materials,
  } = opts;
  const keep = opts.windows || (() => true);
  const wins = glazing.windows
    .map((w, i) => ({ ...w, i }))
    .filter((w, i) => keep(w, i) && w.z1 > zA && w.z0 < zB)
    .map((w) => ({ ...w, z0: Math.max(w.z0, zA), z1: Math.min(w.z1, zB) }));

  /* ---- Rings: ends, every opening edge and its frame band, then filled ---- */
  const ringSet = new Set([zA, zB]);
  for (const w of wins) {
    for (const z of [w.z0, w.z1, w.z0 - frameZ, w.z1 + frameZ]) if (z > zA && z < zB) ringSet.add(z);
  }
  for (const z of opts.rings || []) if (z > zA && z < zB) ringSet.add(z);
  const sorted = [...ringSet].sort((a, b) => a - b);
  const rings = [];
  for (let i = 0; i < sorted.length; i++) {
    if (rings.length && sorted[i] - rings[rings.length - 1] < 1e-4) continue;
    if (rings.length) {
      const a = rings[rings.length - 1];
      const n = Math.ceil((sorted[i] - a) / maxStep);
      for (let j = 1; j < n; j++) rings.push(a + ((sorted[i] - a) * j) / n);
    }
    rings.push(sorted[i]);
  }

  /* ---- Around: knots on every line a window uses, and its frame lines ---- */
  // Arc length per radian of section, roughly: turns a frame width in metres
  // into an angle. The superellipse is not a circle, so this is the mean of
  // its half-width and half-height — close enough for a 3 cm band.
  const rate = (z) => {
    const c = h.section(z);
    return Math.max(0.05, (c.w + Math.max(c.ht, c.hb)) / 2);
  };
  const used = new Set();
  for (const w of wins) {
    used.add(w.from);
    used.add(w.to);
  }
  const knotDefs = [];
  for (const name of used) {
    const base = (z) => lineAt(glazing, name, z);
    knotDefs.push({ at: base });
    if (name !== 'top') knotDefs.push({ at: (z) => base(z) - frame / rate(z) });
    if (name !== 'bottom') knotDefs.push({ at: (z) => base(z) + frame / rate(z) });
  }
  for (const k of knotDefs) {
    let sum = 0;
    for (const z of rings) sum += clamp(k.at(z), 0, Math.PI);
    k.t = clamp(sum / rings.length / Math.PI, 0.001, 0.999);
  }
  knotDefs.sort((a, b) => a.t - b.t);
  let canon = [];
  for (let i = 0; i <= radial; i++) canon.push({ t: i / radial, knot: -1 });
  const minGap = 0.4 / radial;
  canon = canon.filter((c) => c.t === 0 || c.t === 1 || knotDefs.every((k) => Math.abs(k.t - c.t) > minGap));
  knotDefs.forEach((k, i) => canon.push({ t: k.t, knot: i }));
  canon.sort((a, b) => a.t - b.t);
  const knotT = [0, ...knotDefs.map((k) => k.t), 1];
  const sAt = (z, t) => {
    const ks = [0];
    for (const k of knotDefs) ks.push(clamp(Math.max(ks[ks.length - 1] + 1e-4, k.at(z)), 0, Math.PI));
    ks.push(Math.PI);
    let i = 0;
    while (i < knotT.length - 2 && t > knotT[i + 1]) i++;
    return lerp(ks[i], ks[i + 1], (t - knotT[i]) / (knotT[i + 1] - knotT[i] || 1));
  };

  /* ---- Vertices: inner skin and outer (glass-line) skin, both sides ---- */
  const nC = canon.length;
  const P = new THREE.Vector3();
  const N = new THREE.Vector3();
  const inner = []; // [side][ring][k] -> { p, n, s }
  for (const side of [1, -1]) {
    const g = [];
    for (const z of rings) {
      const row = [];
      for (let k = 0; k < nC; k++) {
        const s = side * sAt(z, canon[k].t);
        h.point(z, s, P);
        h.normal(z, s, N);
        row.push({
          p: P.clone().addScaledVector(N, -inset),
          // The reveal's outer edge goes a few millimetres THROUGH the skin,
          // so a ray grazing along the glass's edge cannot slip between it
          // and the outside skin (which is culled from inside) and show sky.
          o: P.clone().addScaledVector(N, inset * 0.15),
          n: N.clone().negate(),
          s,
          z,
        });
      }
      g.push(row);
    }
    inner.push(g);
  }

  /* ---- Classify each quad ---- */
  const sideName = (si) => (si === 0 ? 'right' : 'left');
  const opening = (si, zc, sc) => {
    const a = Math.abs(sc);
    for (const w of wins) {
      if (w.side !== 'both' && w.side !== sideName(si)) continue;
      if (zc <= w.z0 || zc >= w.z1) continue;
      const s0 = lineAt(glazing, w.from, zc);
      const s1 = lineAt(glazing, w.to, zc);
      if (a > Math.min(s0, s1) && a < Math.max(s0, s1)) return w;
    }
    return null;
  };
  const framed = (si, zc, sc) => {
    const a = Math.abs(sc);
    for (const w of wins) {
      if (w.side !== 'both' && w.side !== sideName(si)) continue;
      if (zc <= w.z0 - frameZ - 1e-5 || zc >= w.z1 + frameZ + 1e-5) continue;
      const r = frame / rate(zc);
      const s0 = Math.min(lineAt(glazing, w.from, zc), lineAt(glazing, w.to, zc));
      const s1 = Math.max(lineAt(glazing, w.from, zc), lineAt(glazing, w.to, zc));
      if (a > s0 - r - 1e-5 && a < s1 + r + 1e-5) return true;
    }
    return false;
  };

  const wallB = new GeoBuilder(true);
  const frameB = new GeoBuilder(false);
  const glassB = new GeoBuilder(false, true);
  const cls = inner.map((g) => g.slice(0, -1).map(() => new Array(nC - 1)));
  inner.forEach((g, si) => {
    for (let r = 0; r < rings.length - 1; r++) {
      for (let k = 0; k < nC - 1; k++) {
        const a = g[r][k];
        const b = g[r][k + 1];
        const c = g[r + 1][k + 1];
        const d = g[r + 1][k];
        const zc = (a.z + c.z) / 2;
        const sc = (a.s + b.s + c.s + d.s) / 4;
        const w = opening(si, zc, sc);
        if (w) {
          cls[si][r][k] = w;
          // The pane, a little inside the outer skin.
          glassB.quad([a, b, c, d].map((v) => v.o.clone().lerp(v.p, 0.45)), a.n);
          continue;
        }
        cls[si][r][k] = framed(si, zc, sc) ? 'frame' : 'wall';
        const target = cls[si][r][k] === 'frame' ? frameB : wallB;
        target.quadV([a, b, c, d], colourAt);
      }
    }
  });

  /* ---- Reveals: the skin's thickness along every opening edge ---- */
  inner.forEach((g, si) => {
    for (let r = 0; r < rings.length - 1; r++) {
      for (let k = 0; k < nC - 1; k++) {
        if (typeof cls[si][r][k] !== 'object') continue;
        const edge = (v1, v2) => frameB.quadRaw([v1.p, v2.p, v2.o, v1.o]);
        // Neighbours: previous / next ring, previous / next knot.
        if (r === 0 || typeof cls[si][r - 1][k] !== 'object') edge(g[r][k], g[r][k + 1]);
        if (r === rings.length - 2 || typeof cls[si][r + 1][k] !== 'object') edge(g[r + 1][k], g[r + 1][k + 1]);
        if (k === 0 ? false : typeof cls[si][r][k - 1] !== 'object') edge(g[r][k], g[r + 1][k]);
        if (k === nC - 2 || typeof cls[si][r][k + 1] !== 'object') edge(g[r][k + 1], g[r + 1][k + 1]);
      }
    }
  });

  const group = new THREE.Group();
  group.name = 'interior skin';
  const meshes = {};
  meshes.wall = wallB.mesh(materials.wall, 'cabin trim');
  meshes.frame = frameB.mesh(materials.frame, 'window frames', true);
  group.add(meshes.wall, meshes.frame);
  if (materials.glass && glassB.count) {
    meshes.glass = glassB.mesh(materials.glass, 'window glass (inside)', true);
    meshes.glass.renderOrder = 5;
    group.add(meshes.glass);
  }

  /* ---- Bulkheads: the section at each end, inset ---- */
  const cap = (z, facing, mat, name) => {
    const ring = [];
    for (let i = 0; i <= 32; i++) {
      const s = -Math.PI + (i / 32) * Math.PI * 2;
      h.point(z, s, P);
      h.normal(z, s, N);
      ring.push(P.clone().addScaledVector(N, -inset * 0.9));
    }
    const c = h.section(z);
    const centre = new THREE.Vector3(0, c.yc, z);
    const b = new GeoBuilder(false);
    for (let i = 0; i < 32; i++) b.tri(centre, ring[i], ring[i + 1], new THREE.Vector3(0, 0, facing));
    const m = b.mesh(mat, name);
    group.add(m);
    return m;
  };
  if (materials.cap !== null) meshes.front = cap(zA, 1, materials.cap || materials.frame, 'front bulkhead');
  if (materials.back !== null) meshes.back = cap(zB, -1, materials.back || materials.cap || materials.frame, 'rear bulkhead');

  return {
    group,
    meshes,
    rings,
    openings: wins,
    /** The inner skin at (z, s): model units. */
    insetPoint(z, s, out = new THREE.Vector3()) {
      h.point(z, s, out);
      h.normal(z, s, N);
      return out.addScaledVector(N, -inset);
    },
    /** Inner half-width at station z and height y. */
    halfWidthAt(z, y) {
      return Math.max(0, h.halfWidthAt(z, y) - inset);
    },
    /**
     * The lower edge of a window on the inner skin, right side (+x), from the
     * centre outward: the sill a glareshield has to meet.
     */
    sill(win, n = 12) {
      const pts = [];
      const s0 = lineAt(glazing, win.from, win.z0);
      const s1 = lineAt(glazing, win.to, win.z0);
      for (let i = 0; i <= n; i++) pts.push(this.insetPoint(win.z0, lerp(s0, s1, i / n)));
      return pts;
    },
  };
}

/**
 * Accumulates triangles for one mesh. Inward-facing: every triangle is wound
 * to agree with the normal it is given (which here points into the cabin).
 */
class GeoBuilder {
  constructor(colours = false, uvs = false) {
    this.pos = [];
    this.nor = [];
    this.col = colours ? [] : null;
    this.uv = uvs ? [] : null;
    this.count = 0;
  }

  tri(a, b, c, n, colours) {
    const e1 = _e1.subVectors(b, a);
    const e2 = _e2.subVectors(c, a);
    const f = _f.crossVectors(e1, e2);
    if (f.lengthSq() < 1e-16) return;
    const flip = f.dot(n) < 0;
    const list = flip ? [a, c, b] : [a, b, c];
    const cl = colours ? (flip ? [colours[0], colours[2], colours[1]] : colours) : null;
    list.forEach((p, i) => {
      this.pos.push(p.x, p.y, p.z);
      this.nor.push(n.x, n.y, n.z);
      if (this.col) {
        const c = cl ? cl[i] : _white;
        this.col.push(c.r, c.g, c.b);
      }
      // Planar UVs for the glass, so the droplet texture sits at a sensible
      // size wherever the pane is: metres-ish along x + z and up y.
      if (this.uv) this.uv.push((p.x + p.z) * 0.9, p.y * 0.9);
    });
    this.count++;
  }

  /** A quad of skin vertices {p, n}, with per-vertex colour. */
  quadV(vs, colourAt) {
    const n = _n.copy(vs[0].n).add(vs[1].n).add(vs[2].n).add(vs[3].n).normalize();
    const cols = this.col ? vs.map((v) => colourAt(v.p, v.s, v.z)) : null;
    this.tri(vs[0].p, vs[1].p, vs[2].p, n, cols && [cols[0], cols[1], cols[2]]);
    this.tri(vs[0].p, vs[2].p, vs[3].p, n, cols && [cols[0], cols[2], cols[3]]);
  }

  /** A quad of plain points facing `n`. */
  quad(ps, n) {
    this.tri(ps[0], ps[1], ps[2], n);
    this.tri(ps[0], ps[2], ps[3], n);
  }

  /** A quad whose facing does not matter (drawn double-sided). */
  quadRaw(ps) {
    const n = _n.subVectors(ps[1], ps[0]).cross(_e2.subVectors(ps[3], ps[0])).normalize();
    this.quad(ps, n.clone());
  }

  mesh(mat, name, doubleSided = false) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    if (this.col) g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    if (this.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.computeBoundingSphere();
    const m = new THREE.Mesh(g, mat);
    m.name = name;
    if (doubleSided && mat && mat.side !== THREE.DoubleSide) m.userData.wantsDoubleSide = true;
    return m;
  }
}
const _e1 = new THREE.Vector3();
const _e2 = new THREE.Vector3();
const _f = new THREE.Vector3();
const _n = new THREE.Vector3();
const _white = new THREE.Color(1, 1, 1);

/**
 * Geometry for the civil aeroplanes: a fuselage that is not a lathe, a wing
 * whose control surfaces are cut out of it, and the small parts in between.
 *
 * Why this exists. All five civil types were one `LatheGeometry` apiece, so
 * every fuselage was round in section and its tail cone ended on the thrust
 * line. A 172's tail does not: the top line runs nearly straight back to the
 * fin and the belly sweeps up to meet it, and the cabin is a box with rounded
 * corners, not a tube. The flaps and ailerons were boxes laid on top of the
 * wing, 14 cm proud of the upper skin, so from any angle you saw six slabs
 * resting on a wing. And the livery texture, mapped around a lathe, painted
 * its cheatline as a ring round the middle of the body.
 *
 * So:
 *
 *   hull()  lofts a fuselage through stations of (half-width, top, bottom,
 *           shoulder height, squareness). Sections are superellipses, so the
 *           same code gives a boxy trainer, a round airliner and a slab-sided
 *           survey twin. Window outlines are LINES THE GRID FOLLOWS, so glass
 *           is a set of the hull's own quads given a different material: no
 *           panes floating a centimetre off the skin, no sawtooth where a
 *           triangle half in the window was cut away. UVs run nose-to-tail
 *           and belly-to-roof, so the livery stripe is a cheatline.
 *
 *   wing()  lofts an aerofoil through span stations and, wherever a control
 *           surface is, stops the fixed wing at the hinge line and lofts the
 *           surface separately behind it — with its pivot on the hinge, so it
 *           deflects about the line it is hinged on and not about its middle.
 *
 * Everything is built in the aeroplane's own unscaled frame (-Z forward, +Y
 * up, +X right), the frame model.js has always used; the caller scales the
 * root. No per-frame work lives here — this runs once per aeroplane built.
 */
import * as THREE from '../../vendor/three.module.js';

const TAU = Math.PI * 2;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;

/* ------------------------------------------------------------------ *
 * Interpolation
 * ------------------------------------------------------------------ */

/**
 * Monotone cubic through (xs, ys) — Fritsch–Carlson. Monotone because a
 * fuselage station table with a plain spline overshoots: the belly bulges
 * below the lowest station you gave it, and a hull that dips under its own
 * gear is exactly the kind of error that is invisible in the numbers.
 */
function monotone(xs, ys) {
  const n = xs.length;
  if (n === 1) return () => ys[0];
  const d = new Array(n - 1);
  const m = new Array(n);
  for (let i = 0; i < n - 1; i++) d[i] = (ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]);
  m[0] = d[0];
  m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) {
      m[i] = 0;
      m[i + 1] = 0;
      continue;
    }
    const a = m[i] / d[i];
    const b = m[i + 1] / d[i];
    const h = a * a + b * b;
    if (h > 9) {
      const t = 3 / Math.sqrt(h);
      m[i] = t * a * d[i];
      m[i + 1] = t * b * d[i];
    }
  }
  return (x) => {
    if (x <= xs[0]) return ys[0];
    if (x >= xs[n - 1]) return ys[n - 1];
    let lo = 0;
    let hi = n - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (xs[mid] > x) hi = mid;
      else lo = mid;
    }
    const h = xs[hi] - xs[lo];
    const t = (x - xs[lo]) / h;
    const t2 = t * t;
    const t3 = t2 * t;
    return (
      (2 * t3 - 3 * t2 + 1) * ys[lo] +
      (t3 - 2 * t2 + t) * h * m[lo] +
      (-2 * t3 + 3 * t2) * ys[hi] +
      (t3 - t2) * h * m[hi]
    );
  };
}

/** Piecewise-linear through (xs, ys), clamped at both ends. */
function linear(xs, ys) {
  const n = xs.length;
  return (x) => {
    if (x <= xs[0]) return ys[0];
    if (x >= xs[n - 1]) return ys[n - 1];
    let i = 0;
    while (x > xs[i + 1]) i++;
    return lerp(ys[i], ys[i + 1], (x - xs[i]) / (xs[i + 1] - xs[i]));
  };
}

/**
 * Stations for a rounded nose: a quarter ellipse from a point at z0 out to
 * the full section `len` further aft. A table-driven spline cannot draw the
 * vertical tangent a round nose has at its tip, so the tip is handed to it
 * as a dense run of stations instead.
 *
 * `to` is the full section ({ w, top, bot, yc }); `tip` is where the point is
 * ({ y }). Returns stations ordered nose first.
 */
export function roundNose(z0, len, to, tip = {}, steps = 6, power = 1) {
  const out = [];
  const tipY = tip.y ?? to.yc ?? (to.top + to.bot) / 2;
  const yc = to.yc ?? (to.top + to.bot) / 2;
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * (Math.PI / 2);
    const k = Math.pow(Math.sin(a), power); // 0 at the tip, 1 at the full section
    const z = z0 + len * (1 - Math.cos(a));
    const c = lerp(tipY, yc, Math.pow(k, 0.5));
    out.push({
      z,
      w: to.w * k,
      top: c + (to.top - yc) * k,
      bot: c - (yc - to.bot) * k,
      yc: c,
      nT: to.nT,
      nB: to.nB,
    });
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Hull
 * ------------------------------------------------------------------ */

/**
 * A fuselage from stations.
 *
 * def = {
 *   stations: [{ z, w, top, bot, yc?, nT?, nB? }, ...]   nose first
 *   radial: 12            quads per half-side before window lines are added
 *   maxStep: 0.3          longest ring spacing
 *   rings: [z, ...]       extra ring stations (window edges are added anyway)
 *   lines: { name: s | (z) => s }   angles from the top centreline (0) to the
 *                         belly (PI) on the right side; mirrored on the left.
 *                         Glass edges run along these, so the grid does too.
 *   windows: [{ z0, z1, from, to, side }]   from/to: line names, or 'top'
 *                         (s = 0) / 'bottom' (s = PI). side: 'both' (default)
 *                         'right' or 'left'.
 *   closeTail: true       fan-cap the last station
 *   uv: { right: offset, left: offset }   see below
 * }
 *
 * `s` is the angle around the section measured from the top, positive on
 * the right. The section at a station is a superellipse split at the
 * shoulder line yc: above it exponent nT and half-height top - yc, below it
 * nB and yc - bot. 2 is an ellipse; 3 is a box with generous corners.
 *
 * UVs: v runs 0 at the belly to 1 on the roof on both sides. u runs along the
 * length, towards the NOSE on the right side and towards the TAIL on the
 * left — because the airframe texture's registration is written left-to-right
 * in u, and those are the two directions that read left-to-right to someone
 * standing beside each side. The seam is at the top and bottom centrelines,
 * so each half has its own vertices there; normals come from the surface
 * itself, not from the triangles, so the seam does not show.
 */
export function hull(def) {
  const st = def.stations;
  const zs = st.map((p) => p.z);
  const yc0 = st.map((p) => p.yc ?? (p.top + p.bot) / 2);
  const fW = monotone(zs, st.map((p) => p.w));
  const fTop = monotone(zs, st.map((p) => p.top));
  const fBot = monotone(zs, st.map((p) => p.bot));
  const fYc = monotone(zs, yc0);
  const fNT = linear(zs, st.map((p) => p.nT ?? def.nT ?? 2.2));
  const fNB = linear(zs, st.map((p) => p.nB ?? def.nB ?? 2.2));
  const zMin = zs[0];
  const zMax = zs[zs.length - 1];

  /** Section parameters at z. */
  const section = (z) => {
    const w = Math.max(0, fW(z));
    const yc = fYc(z);
    return {
      w,
      yc,
      ht: Math.max(0, fTop(z) - yc),
      hb: Math.max(0, yc - fBot(z)),
      nT: fNT(z),
      nB: fNB(z),
    };
  };

  /** A point on the skin. s: signed angle from the top, right positive. */
  const point = (z, s, out = new THREE.Vector3()) => {
    const c = section(z);
    const a = Math.abs(s);
    const side = s < 0 ? -1 : 1;
    const sn = Math.sin(a);
    const cs = Math.cos(a);
    const upper = cs >= 0;
    const n = upper ? c.nT : c.nB;
    const e = 2 / n;
    const x = side * c.w * Math.pow(Math.abs(sn), e);
    const y = upper ? c.yc + c.ht * Math.pow(cs, e) : c.yc - c.hb * Math.pow(-cs, e);
    return out.set(x, y, z);
  };

  /** Outward normal from the surface, by central differences. */
  const _a = new THREE.Vector3();
  const _b = new THREE.Vector3();
  const _c = new THREE.Vector3();
  const _d = new THREE.Vector3();
  const normal = (z, s, out = new THREE.Vector3()) => {
    // Near the nose point the section has no size and the angle derivative
    // vanishes; step back until there is something to measure.
    let zz = z;
    for (let k = 0; k < 6; k++) {
      const c = section(zz);
      if (c.w + c.ht + c.hb > 1e-3) break;
      zz += (zMax - zMin) * 0.004 * (zz <= (zMin + zMax) / 2 ? 1 : -1);
    }
    const ds = 1e-3;
    const dz = 1e-3;
    point(zz, s + ds, _a);
    point(zz, s - ds, _b);
    _a.sub(_b); // d/ds
    point(clamp(zz + dz, zMin, zMax), s, _c);
    point(clamp(zz - dz, zMin, zMax), s, _d);
    _c.sub(_d); // d/dz
    out.crossVectors(_c, _a);
    // Outward: away from the section's own centre line.
    const cen = section(zz);
    point(zz, s, _d);
    _d.x -= 0;
    _d.y -= cen.yc;
    _d.z = 0;
    if (out.dot(_d) < 0) out.negate();
    /*
     * Degenerate only against the size of the two differences it was made
     * from. This was an absolute 1e-12 on the square of a cross product of
     * 2 mm steps, which is 1e-12 m^4 — so any part under about 0.35 m across
     * fell under it everywhere: every normal of the Skylark's wheel spats,
     * the Tempest's nacelles and sponsons, the Skyhook's tail boom and the
     * last metre of every tail cone came out as (0, 0, +-1). They were lit
     * as if they faced the nose, and tri() below, which winds each triangle
     * by its vertex normals, turned a third of the spat's triangles inward:
     * holes, with the tyre showing black through the top of the spat.
     */
    const ref = _a.lengthSq() * _c.lengthSq();
    if (!(out.lengthSq() > ref * 1e-10)) out.set(0, 0, z < (zMin + zMax) / 2 ? -1 : 1);
    return out.normalize();
  };

  /* Ring stations: every table station, every window edge, and enough in
   * between that no span is longer than maxStep. */
  const maxStep = def.maxStep ?? 0.3;
  const ringSet = new Set(zs);
  for (const z of def.rings || []) ringSet.add(z);
  for (const w of def.windows || []) {
    ringSet.add(w.z0);
    ringSet.add(w.z1);
  }
  let rings = [...ringSet].filter((z) => z >= zMin && z <= zMax).sort((a, b) => a - b);
  const dedup = [];
  for (const z of rings) if (!dedup.length || z - dedup[dedup.length - 1] > 1e-4) dedup.push(z);
  rings = [];
  for (let i = 0; i < dedup.length; i++) {
    rings.push(dedup[i]);
    if (i === dedup.length - 1) break;
    const gap = dedup[i + 1] - dedup[i];
    const k = Math.ceil(gap / maxStep);
    for (let j = 1; j < k; j++) rings.push(dedup[i] + (gap * j) / k);
  }

  /* Around: fixed canonical positions t in [0, 1] (0 = top, 1 = belly), with
   * each named line pinned at its own canonical t. Per ring the lines move
   * (a window can taper), and the samples between them are spread evenly, so
   * the ordering never changes and nothing twists. */
  const lineDefs = Object.entries(def.lines || {}).map(([name, v]) => ({
    name,
    at: typeof v === 'function' ? v : () => v,
  }));
  const zMid = (zMin + zMax) / 2;
  // Canonical position of each line: its mean angle over the rings.
  for (const L of lineDefs) {
    let sum = 0;
    for (const z of rings) sum += L.at(z);
    L.t = clamp(sum / rings.length / Math.PI, 0.002, 0.998);
  }
  lineDefs.sort((a, b) => a.t - b.t);
  const radial = def.radial ?? 12;
  let canon = [];
  for (let i = 0; i <= radial; i++) canon.push({ t: i / radial, line: null });
  const minGap = 0.35 / radial;
  canon = canon.filter((c) => c.t === 0 || c.t === 1 || lineDefs.every((L) => Math.abs(L.t - c.t) > minGap));
  for (const L of lineDefs) canon.push({ t: L.t, line: L.name });
  canon.sort((a, b) => a.t - b.t);
  const lineIndex = { top: 0, bottom: canon.length - 1 };
  canon.forEach((c, i) => {
    if (c.line) lineIndex[c.line] = i;
  });
  const knotsT = [0, ...lineDefs.map((L) => L.t), 1];
  /** Canonical t to angle, at this ring. */
  const sAt = (z, t) => {
    const knotS = [0];
    for (const L of lineDefs) knotS.push(Math.max(knotS[knotS.length - 1] + 1e-3, clamp(L.at(z), 0, Math.PI)));
    knotS.push(Math.PI);
    let i = 0;
    while (i < knotsT.length - 2 && t > knotsT[i + 1]) i++;
    return lerp(knotS[i], knotS[i + 1], (t - knotsT[i]) / (knotsT[i + 1] - knotsT[i]));
  };

  const windows = (def.windows || []).map((w) => ({
    z0: w.z0,
    z1: w.z1,
    i0: lineIndex[w.from ?? 'top'],
    i1: lineIndex[w.to],
    side: w.side || 'both',
  }));
  for (const w of windows) {
    if (w.i0 === undefined || w.i1 === undefined) throw new Error('hull window names an unknown line');
    if (w.i0 > w.i1) [w.i0, w.i1] = [w.i1, w.i0];
  }
  const isGlass = (zc, k, sideName) => {
    for (const w of windows) {
      if (zc < w.z0 || zc > w.z1) continue;
      if (w.side !== 'both' && w.side !== sideName) continue;
      if (k >= w.i0 && k < w.i1) return true;
    }
    return false;
  };

  const uvR = def.uv?.right ?? 0;
  const uvL = def.uv?.left ?? -0.7;
  /*
   * A part that is not the fuselage — a spat, a fillet, a nacelle, a sponson
   * — must not wear the livery's stripe. Mapped like a fuselage, each one
   * got a cheatline of its own at whatever height its own section put it:
   * orange bands down the Tempest's nacelles and sponsons, red ones round the
   * Skylark's wheel spats. `uvBand` pins v to one row of the texture that is
   * plain paint (0.2 is canvas y 0.8, between the stripes and the edge) and
   * squeezes u so the part does not collect a panel line every tenth.
   */
  const band = def.uvBand;
  const pos = [];
  const nor = [];
  const uv = [];
  const skinIdx = [];
  const glassIdx = [];
  const P = new THREE.Vector3();
  const N = new THREE.Vector3();
  const nC = canon.length;
  const grid = []; // grid[side][ring][k] = vertex index

  for (const side of [1, -1]) {
    const g = [];
    for (const z of rings) {
      const row = [];
      const tl = (z - zMin) / (zMax - zMin || 1);
      for (let k = 0; k < nC; k++) {
        const s = side * sAt(z, canon[k].t);
        point(z, s, P);
        normal(z, s, N);
        row.push(pos.length / 3);
        pos.push(P.x, P.y, P.z);
        nor.push(N.x, N.y, N.z);
        if (band !== undefined) uv.push(tl * 0.3, band);
        else uv.push(side > 0 ? uvR + (1 - tl) : uvL + tl, 1 - Math.abs(s) / Math.PI);
      }
      g.push(row);
    }
    grid.push(g);
  }

  // Quads, wound so their face normal agrees with the surface normal.
  const tri = (list, a, b, c) => {
    const ax = pos[a * 3], ay = pos[a * 3 + 1], az = pos[a * 3 + 2];
    const e1x = pos[b * 3] - ax, e1y = pos[b * 3 + 1] - ay, e1z = pos[b * 3 + 2] - az;
    const e2x = pos[c * 3] - ax, e2y = pos[c * 3 + 1] - ay, e2z = pos[c * 3 + 2] - az;
    const fx = e1y * e2z - e1z * e2y;
    const fy = e1z * e2x - e1x * e2z;
    const fz = e1x * e2y - e1y * e2x;
    if (fx * fx + fy * fy + fz * fz < 1e-14) return; // degenerate: the nose point
    const nx = nor[a * 3] + nor[b * 3] + nor[c * 3];
    const ny = nor[a * 3 + 1] + nor[b * 3 + 1] + nor[c * 3 + 1];
    const nz = nor[a * 3 + 2] + nor[b * 3 + 2] + nor[c * 3 + 2];
    if (fx * nx + fy * ny + fz * nz >= 0) list.push(a, b, c);
    else list.push(a, c, b);
  };
  grid.forEach((g, si) => {
    const sideName = si === 0 ? 'right' : 'left';
    for (let r = 0; r < rings.length - 1; r++) {
      const zc = (rings[r] + rings[r + 1]) / 2;
      for (let k = 0; k < nC - 1; k++) {
        const list = isGlass(zc, k, sideName) ? glassIdx : skinIdx;
        const a = g[r][k];
        const b = g[r][k + 1];
        const c = g[r + 1][k + 1];
        const d = g[r + 1][k];
        tri(list, a, b, c);
        tri(list, a, c, d);
      }
    }
  });

  // Close the tail with a flat cap, if the last station has any size.
  if (def.closeTail !== false) {
    const last = rings.length - 1;
    const c = section(zMax);
    if (c.w > 1e-3) {
      const centre = pos.length / 3;
      pos.push(0, c.yc, zMax);
      nor.push(0, 0, 1);
      uv.push(0.5, 0.5);
      const capVerts = [];
      for (const [si, g] of grid.entries()) {
        const row = si === 0 ? g[last] : [...g[last]].reverse();
        for (const vi of row) {
          const ni = pos.length / 3;
          pos.push(pos[vi * 3], pos[vi * 3 + 1], pos[vi * 3 + 2]);
          nor.push(0, 0, 1);
          uv.push(uv[vi * 2], uv[vi * 2 + 1]);
          capVerts.push(ni);
        }
      }
      for (let i = 0; i < capVerts.length; i++) {
        const a = capVerts[i];
        const b = capVerts[(i + 1) % capVerts.length];
        tri(skinIdx, centre, a, b);
      }
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex([...skinIdx, ...glassIdx]);
  geo.addGroup(0, skinIdx.length, 0);
  if (glassIdx.length) geo.addGroup(skinIdx.length, glassIdx.length, 1);

  return {
    geometry: geo,
    point,
    normal,
    section,
    zMin,
    zMax,
    /** Half-width of the skin at height y above the axis, at station z. */
    halfWidthAt(z, y) {
      const c = section(z);
      const up = y >= c.yc;
      const h = up ? c.ht : c.hb;
      if (h <= 1e-6) return c.w;
      const q = clamp(Math.abs(y - c.yc) / h, 0, 1);
      const n = up ? c.nT : c.nB;
      return c.w * Math.pow(Math.max(0, 1 - Math.pow(q, n)), 1 / n);
    },
    /**
     * A flat bulkhead filling the section at z, facing aft (+Z) — visible
     * only from inside, behind it. For the firewall under the windscreen:
     * the pilot's eye is inside the closed hull, where every face is culled,
     * so without one the view below the windscreen's lower edge went
     * straight through the engine to the runway.
     */
    capAt(z, segments = 24) {
      const c = section(z);
      const pos = [0, c.yc, z];
      const nor = [0, 0, 1];
      const uv = [0.5, 0.5];
      const idx = [];
      const P = new THREE.Vector3();
      for (let i = 0; i <= segments; i++) {
        point(z, -Math.PI + (i / segments) * Math.PI * 2, P);
        pos.push(P.x, P.y, z);
        nor.push(0, 0, 1);
        uv.push(0.5, 0.5);
      }
      for (let i = 1; i <= segments; i++) idx.push(0, i, i + 1);
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      g.setIndex(idx);
      // Wind towards +Z whichever way round the section was walked.
      const a = new THREE.Vector3(pos[3], pos[4], pos[5]);
      const b = new THREE.Vector3(pos[6], pos[7], pos[8]);
      const o = new THREE.Vector3(pos[0], pos[1], pos[2]);
      if (a.sub(o).cross(b.sub(o)).z < 0) flipWinding(g);
      g.computeVertexNormals();
      return g;
    },
    /** Top and bottom of the skin on the centreline at z. */
    topAt: (z) => section(z).yc + section(z).ht,
    botAt: (z) => section(z).yc - section(z).hb,
    /** The angle s at which the skin on the right side reaches height y. */
    angleAt(z, y) {
      const c = section(z);
      if (y >= c.yc) {
        const q = clamp((y - c.yc) / (c.ht || 1e-6), 0, 1);
        return Math.acos(Math.pow(q, c.nT / 2));
      }
      const q = clamp((c.yc - y) / (c.hb || 1e-6), 0, 1);
      return Math.PI - Math.acos(Math.pow(q, c.nB / 2));
    },
  };
}

/* ------------------------------------------------------------------ *
 * Aerofoils and lofted surfaces
 * ------------------------------------------------------------------ */

/** NACA 4-digit thickness at chord fraction x (fraction of chord). */
function naThick(x, t) {
  return 5 * t * (0.2969 * Math.sqrt(x) - 0.126 * x - 0.3516 * x * x + 0.2843 * x ** 3 - 0.1036 * x ** 4);
}
/** NACA 4-digit camber line, maximum camber m at 40% chord. */
function naCamber(x, m) {
  if (!m) return 0;
  return x < 0.4 ? (m / 0.16) * (0.8 * x - x * x) : (m / 0.36) * (0.2 + 0.8 * x - x * x);
}

/**
 * The strips that make one aerofoil section between chord fractions x0 and
 * x1, in (chord, thickness) coordinates.
 *
 * A strip is a run of points whose vertices are shared, so shading is smooth
 * along it; separate strips get separate vertices, so the join is a crease.
 * The leading edge is inside a strip (smooth); the trailing edge and the cut
 * face at a hinge line are joins (sharp) — which is what the real parts are.
 */
function sectionStrips(x0, x1, steps, t, m, { roundFront = false } = {}) {
  // Cosine spacing, so the leading edge gets the points it needs.
  const xs = [];
  for (let i = 0; i <= steps; i++) {
    const u = i / steps;
    const c = (1 - Math.cos(u * Math.PI)) / 2;
    xs.push(lerp(x0, x1, c));
  }
  const up = (x) => [x, naCamber(x, m) + naThick(x, t)];
  const lo = (x) => [x, naCamber(x, m) - naThick(x, t)];
  const strips = [];
  if (x0 <= 1e-6) {
    // Lower aft end, round the nose, upper aft end: one smooth strip.
    const main = [];
    for (let i = xs.length - 1; i >= 1; i--) main.push(lo(xs[i]));
    main.push([0, 0]);
    for (let i = 1; i < xs.length; i++) main.push(up(xs[i]));
    strips.push(main);
  } else if (roundFront) {
    // A control surface: its nose is a half-round tucked into the cove.
    const hTop = up(x0);
    const hBot = lo(x0);
    const r = (hTop[1] - hBot[1]) / 2;
    const cy = (hTop[1] + hBot[1]) / 2;
    const nose = [];
    const n = 5;
    for (let i = 0; i <= n; i++) {
      const a = -Math.PI / 2 + (i / n) * Math.PI; // bottom, round the front, top
      nose.push([x0 - Math.cos(a) * r * 0.8, cy + Math.sin(a) * r]);
    }
    nose[0] = hBot;
    nose[n] = hTop;
    const main = [];
    for (let i = xs.length - 1; i >= 1; i--) main.push(lo(xs[i]));
    for (let i = 0; i <= n; i++) main.push(nose[i]);
    for (let i = 1; i < xs.length; i++) main.push(up(xs[i]));
    strips.push(main);
  } else {
    const lower = [];
    for (let i = xs.length - 1; i >= 0; i--) lower.push(lo(xs[i]));
    const upper = [];
    for (let i = 0; i < xs.length; i++) upper.push(up(xs[i]));
    strips.push(lower, [lo(x0), up(x0)], upper);
  }
  if (x1 < 1 - 1e-6) strips.push([up(x1), lo(x1)]); // the cut face at the hinge
  return strips;
}

/**
 * Loft strips through span stations, in the canonical frame: span along +X,
 * thickness along +Y, chord along +Z (aft). Stations: { s, chord, le, y,
 * thick, drop } where `thick` scales the section's thickness and `drop` moves
 * it down. Returns arrays for merging.
 */
function loftStrips(stations, stripsOf, caps, uvV) {
  const pos = [];
  const nor = [];
  const uv = [];
  const idx = [];
  const at = (S, p) => [S.s, S.y + p[1] * S.chord * (S.thick ?? 1), S.le + p[0] * S.chord];
  const strips0 = stripsOf(0);
  const nStrips = strips0.length;
  const s0 = stations[0].s;
  const s1 = stations[stations.length - 1].s;
  for (let k = 0; k < nStrips; k++) {
    const base = pos.length / 3;
    const len = strips0[k].length;
    stations.forEach((S, si) => {
      const strip = stripsOf(si)[k];
      for (const p of strip) {
        const v = at(S, p);
        pos.push(v[0], v[1], v[2]);
        nor.push(0, 0, 0);
        uv.push(p[0], uvV((S.s - s0) / (s1 - s0 || 1)));
      }
    });
    for (let si = 0; si < stations.length - 1; si++) {
      for (let i = 0; i < len - 1; i++) {
        const a = base + si * len + i;
        const b = base + si * len + i + 1;
        const c = base + (si + 1) * len + i + 1;
        const d = base + (si + 1) * len + i;
        // Strips run lower-aft -> nose -> upper-aft; with span along +X,
        // (a, b, c) faces +Y on the upper skin and -Y on the lower: outward.
        idx.push(a, b, c, a, c, d);
      }
    }
  }
  // Caps: a fan from a point inside the section.
  for (const which of caps) {
    const si = which === 'start' ? 0 : stations.length - 1;
    const S = stations[si];
    const ring = [];
    for (const strip of stripsOf(si)) for (const p of strip) {
      const last = ring[ring.length - 1];
      if (!last || Math.hypot(last[0] - p[0], last[1] - p[1]) > 1e-7) ring.push(p);
    }
    if (ring.length > 2 && Math.hypot(ring[0][0] - ring[ring.length - 1][0], ring[0][1] - ring[ring.length - 1][1]) < 1e-7) ring.pop();
    let cx = 0;
    let cy = 0;
    for (const p of ring) {
      cx += p[0];
      cy += p[1];
    }
    cx /= ring.length;
    cy /= ring.length;
    const centre = pos.length / 3;
    const cv = at(S, [cx, cy]);
    pos.push(cv[0], cv[1], cv[2]);
    nor.push(which === 'start' ? -1 : 1, 0, 0);
    uv.push(cx, uvV(si === 0 ? 0 : 1));
    const first = pos.length / 3;
    for (const p of ring) {
      const v = at(S, p);
      pos.push(v[0], v[1], v[2]);
      nor.push(which === 'start' ? -1 : 1, 0, 0);
      uv.push(p[0], uvV(si === 0 ? 0 : 1));
    }
    for (let i = 0; i < ring.length; i++) {
      const a = first + i;
      const b = first + ((i + 1) % ring.length);
      // The ring runs lower-aft, nose, upper-aft, which makes (centre, a, b)
      // face +X: right for the outboard end, reversed for the inboard one.
      if (which === 'end') idx.push(centre, a, b);
      else idx.push(centre, b, a);
    }
  }
  return { pos, nor, uv, idx };
}

/** Smooth vertex normals for the strip part only (caps keep theirs). */
function finishLoft(parts) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(parts.pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(parts.uv, 2));
  geo.setIndex(parts.idx);
  const keep = parts.nor.slice();
  geo.computeVertexNormals();
  // Cap vertices were given a flat normal; computeVertexNormals would have
  // produced the same thing for a planar fan, so nothing to restore — but
  // the degenerate centre-less strips (zero-area) leave zero normals, which
  // Three would render black. Fall back to the stored ones there.
  const n = geo.attributes.normal;
  for (let i = 0; i < n.count; i++) {
    if (Math.abs(n.getX(i)) + Math.abs(n.getY(i)) + Math.abs(n.getZ(i)) < 1e-6) {
      n.setXYZ(i, keep[i * 3], keep[i * 3 + 1], keep[i * 3 + 2]);
    }
  }
  return geo;
}

/**
 * A lifting surface with its control surfaces cut out of it.
 *
 * def = {
 *   stations: [{ s, chord, le, y, thick? }]  span position from the root,
 *               in order; linear between them
 *   t, m: thickness and camber (fractions of chord); steps: points per side
 *   cuts: [{ name, s0, s1, hinge, gap? }]   a surface from span s0 to s1,
 *               hinged at `hinge` (fraction of chord)
 *   tipRound: span taken to round the tip off (0: flat cap)
 *   rootCap: whether the root needs closing (not if it meets its twin)
 *   frame: 'right' | 'left' | 'fin'   where the canonical frame is turned to
 *   uvV: [v0, v1]   texture band the span maps to (see airframe texture)
 * }
 *
 * Returns { fixed: BufferGeometry, surfaces: { name: { geometry, pivot:
 * Vector3, quat: Quaternion } } } — surface geometry is in its own pivot's
 * frame, with local +X along the hinge, so a deflection is one rotation
 * about X.
 */
export function wing(def) {
  const T = def.t ?? 0.13;
  const M = def.m ?? 0.02;
  const steps = def.steps ?? 7;
  const V0 = def.uvV ? def.uvV[0] : 0.64;
  const V1 = def.uvV ? def.uvV[1] : 0.98;
  const uvV = (f) => lerp(V0, V1, f);
  const st = def.stations;
  const sx = st.map((p) => p.s);
  const fChord = linear(sx, st.map((p) => p.chord));
  const fLe = linear(sx, st.map((p) => p.le));
  const fY = linear(sx, st.map((p) => p.y));
  const fThick = linear(sx, st.map((p) => p.thick ?? 1));
  const S = (s) => ({ s, chord: fChord(s), le: fLe(s), y: fY(s), thick: fThick(s) });
  const sRoot = sx[0];
  let sTip = sx[sx.length - 1];
  const cuts = (def.cuts || []).map((c) => ({ gap: 0.02, ...c }));

  // Frame: canonical (span +X, thick +Y, chord +Z) to the part's own axes.
  const mtx = new THREE.Matrix4();
  if (def.frame === 'left') mtx.makeScale(-1, 1, 1);
  else if (def.frame === 'fin') mtx.makeRotationZ(Math.PI / 2); // span up, thickness to -X
  // A lean (radians, about Z after the frame) for winglets and canted fins.
  if (def.lean) mtx.premultiply(new THREE.Matrix4().makeRotationZ(def.lean));
  if (def.origin) mtx.premultiply(new THREE.Matrix4().makeTranslation(def.origin[0], def.origin[1], def.origin[2]));
  const flip = mtx.determinant() < 0;

  // Span breakpoints: stations, cut edges, and the tip rounding.
  const round = def.tipRound ?? 0;
  const sFull = sTip - round;
  const bp = new Set(sx.filter((s) => s <= sFull + 1e-6));
  bp.add(sFull);
  for (const c of cuts) {
    bp.add(c.s0);
    bp.add(c.s1);
  }
  const breaks = [...bp].filter((s) => s >= sRoot - 1e-6 && s <= sFull + 1e-6).sort((a, b) => a - b);
  const cutAt = (a, b) => cuts.find((c) => a >= c.s0 - 1e-6 && b <= c.s1 + 1e-6) || null;

  // Runs of consecutive intervals sharing the same profile.
  const runs = [];
  for (let i = 0; i < breaks.length - 1; i++) {
    const a = breaks[i];
    const b = breaks[i + 1];
    if (b - a < 1e-5) continue;
    const c = cutAt(a, b);
    const key = c ? c.name : '';
    const last = runs[runs.length - 1];
    if (last && last.key === key) last.ss.push(b);
    else runs.push({ key, cut: c, ss: [a, b] });
  }

  const all = { pos: [], nor: [], uv: [], idx: [] };
  const add = (parts) => {
    const off = all.pos.length / 3;
    all.pos.push(...parts.pos);
    all.nor.push(...parts.nor);
    all.uv.push(...parts.uv);
    for (const i of parts.idx) all.idx.push(i + off);
  };

  runs.forEach((run, ri) => {
    const x1 = run.cut ? run.cut.hinge : 1;
    const stations = run.ss.map(S);
    const strips = sectionStrips(0, x1, steps, T, M);
    const caps = [];
    const prev = runs[ri - 1];
    const next = runs[ri + 1];
    // A cut run's ends are buried in its full neighbours, so only full runs
    // (and anything at the very root or tip) need closing.
    if (ri === 0 ? def.rootCap : !run.cut && prev && prev.cut) caps.push('start');
    if (ri === runs.length - 1 ? round <= 0 : !run.cut && next && next.cut) caps.push('end');
    if (ri === runs.length - 1 && run.cut && round <= 0) caps.push('end');
    add(loftStrips(stations, () => strips, caps, uvV));
  });

  // The tip, rounded: a quarter ellipse in thickness, with the chord
  // pulling in a little from both edges.
  if (round > 0) {
    const base = S(sFull);
    const ts = [base];
    const n = 3;
    for (let i = 1; i <= n; i++) {
      const a = (i / n) * (Math.PI / 2);
      const k = Math.cos(a);
      const shrink = lerp(1, 0.55, 1 - k);
      ts.push({
        s: sFull + round * Math.sin(a),
        chord: base.chord * shrink,
        le: base.le + base.chord * (1 - shrink) * 0.7,
        y: base.y,
        thick: base.thick * Math.max(0.04, k) / shrink,
      });
    }
    const strips = sectionStrips(0, 1, steps, T, M);
    add(loftStrips(ts, () => strips, ['end'], uvV));
  }

  const fixed = finishLoft(all);
  fixed.applyMatrix4(mtx);
  if (flip) flipWinding(fixed);

  const surfaces = {};
  for (const c of cuts) {
    const a = c.s0 + c.gap;
    const b = c.s1 - c.gap;
    const stations = [S(a), S(b)];
    const strips = sectionStrips(c.hinge + c.gap * 0.5, 1, Math.max(4, Math.round(steps * 0.6)), T, M, {
      roundFront: true,
    });
    const g = finishLoft(loftStrips(stations, () => strips, ['start', 'end'], uvV));
    g.applyMatrix4(mtx);
    if (flip) flipWinding(g);
    // The hinge line, on the camber line at the hinge fraction.
    const hy = (st2) => st2.y + naCamber(c.hinge, M) * st2.chord * st2.thick;
    const pa = new THREE.Vector3(a, hy(stations[0]), stations[0].le + c.hinge * stations[0].chord).applyMatrix4(mtx);
    const pb = new THREE.Vector3(b, hy(stations[1]), stations[1].le + c.hinge * stations[1].chord).applyMatrix4(mtx);
    // Local +X along the hinge, pointing to +X on both wings and up on the
    // fin — so one sign convention (positive = trailing edge down, or to
    // the right) holds for every surface.
    const dir = pb.clone().sub(pa).normalize();
    if (def.frame === 'fin' ? dir.y < 0 : dir.x < 0) dir.negate();
    const pivot = def.frame === 'left' ? pb.clone() : pa.clone();
    const quat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(1, 0, 0), dir);
    const inv = quat.clone().invert();
    g.translate(-pivot.x, -pivot.y, -pivot.z);
    g.applyQuaternion(inv);
    surfaces[c.name] = { geometry: g, pivot, quat };
  }
  return { fixed, surfaces, S };
}

/**
 * Map a small part to plain paint: every v on the one row of the airframe
 * texture that is neither stripe nor registration (see hull's uvBand), u
 * squeezed so it does not pick up a panel line per tenth. A BoxGeometry
 * otherwise maps the whole texture onto each face, stripes and all — the
 * Courier's gear doors each wore a strip of cheatline.
 */
export function plainUV(geo, band = 0.2) {
  const uv = geo.attributes.uv;
  if (!uv) return geo;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 0.3, band);
  uv.needsUpdate = true;
  return geo;
}

/** Reverse every triangle, for geometry that has been mirrored. */
function flipWinding(geo) {
  const idx = geo.index.array;
  for (let i = 0; i < idx.length; i += 3) {
    const t = idx[i + 1];
    idx[i + 1] = idx[i + 2];
    idx[i + 2] = t;
  }
  geo.index.needsUpdate = true;
  // A mirror flips normals' handedness too: re-derive them.
  geo.computeVertexNormals();
}

/* ------------------------------------------------------------------ *
 * Turned parts
 * ------------------------------------------------------------------ */

/**
 * A body of revolution about +Z from (r, z) pairs, nose first. Used for
 * spinners, nacelles, wheel hubs and the like. UVs are pinned to one texel
 * band (v = vBand) so the airframe texture's stripes do not wrap round it
 * as rings; u runs round.
 */
export function turned(profile, segments = 16, { vBand = 0.8, closeEnds = false, yScale = 1 } = {}) {
  const pos = [];
  const uv = [];
  const idx = [];
  const n = profile.length;
  for (let i = 0; i < n; i++) {
    const [r, z] = profile[i];
    for (let j = 0; j <= segments; j++) {
      const a = (j / segments) * TAU;
      pos.push(Math.sin(a) * r, Math.cos(a) * r * yScale, z);
      uv.push(j / segments, vBand);
    }
  }
  const row = segments + 1;
  for (let i = 0; i < n - 1; i++) {
    for (let j = 0; j < segments; j++) {
      const a = i * row + j;
      const b = a + 1;
      const c = a + row + 1;
      const d = a + row;
      // With z increasing along the profile and the angle running +Y to +X,
      // (a, d, b) faces outward when the radius is positive.
      idx.push(a, d, b, b, d, c);
    }
  }
  if (closeEnds) {
    for (const i of [0, n - 1]) {
      const [r, z] = profile[i];
      if (r < 1e-5) continue;
      const centre = pos.length / 3;
      pos.push(0, 0, z);
      uv.push(0.5, vBand);
      for (let j = 0; j < segments; j++) {
        const a = i * row + j;
        const b = a + 1;
        // (centre, a, b) faces -Z: the front end. The back end is reversed.
        if (i === 0) idx.push(centre, a, b);
        else idx.push(centre, b, a);
      }
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  // The seam column has duplicated vertices; average them so it is smooth.
  const nrm = geo.attributes.normal;
  for (let i = 0; i < n; i++) {
    const a = i * row;
    const b = i * row + segments;
    const x = nrm.getX(a) + nrm.getX(b);
    const y = nrm.getY(a) + nrm.getY(b);
    const z = nrm.getZ(a) + nrm.getZ(b);
    const l = Math.hypot(x, y, z) || 1;
    nrm.setXYZ(a, x / l, y / l, z / l);
    nrm.setXYZ(b, x / l, y / l, z / l);
  }
  return geo;
}

/**
 * A tube along a polyline — gear legs, skids, struts, exhaust pipes.
 * `radii` may be one number or one per point; `flat` squashes the section
 * across the path (a streamlined strut is an ellipse, not a pipe).
 */
export function tubePath(points, radii, segments = 8, { flat = 1, up = new THREE.Vector3(0, 1, 0), caps = true } = {}) {
  const pts = points.map((p) => (p.isVector3 ? p.clone() : new THREE.Vector3(p[0], p[1], p[2])));
  const R = (i) => (Array.isArray(radii) ? radii[i] : radii);
  const pos = [];
  const uv = [];
  const idx = [];
  const T = new THREE.Vector3();
  const B = new THREE.Vector3();
  const Nn = new THREE.Vector3();
  const row = segments + 1;
  for (let i = 0; i < pts.length; i++) {
    if (i === 0) T.subVectors(pts[1], pts[0]);
    else if (i === pts.length - 1) T.subVectors(pts[i], pts[i - 1]);
    else T.subVectors(pts[i + 1], pts[i - 1]);
    T.normalize();
    // Section axes: B across (squashed by `flat`), Nn the other way.
    B.crossVectors(T, up);
    if (B.lengthSq() < 1e-8) B.crossVectors(T, new THREE.Vector3(1, 0, 0));
    B.normalize();
    Nn.crossVectors(B, T).normalize();
    for (let j = 0; j <= segments; j++) {
      const a = (j / segments) * TAU;
      const r = R(i);
      const x = Math.cos(a) * r;
      const y = Math.sin(a) * r * flat;
      pos.push(pts[i].x + Nn.x * x + B.x * y, pts[i].y + Nn.y * x + B.y * y, pts[i].z + Nn.z * x + B.z * y);
      uv.push(j / segments, 0.8);
    }
  }
  for (let i = 0; i < pts.length - 1; i++) {
    for (let j = 0; j < segments; j++) {
      const a = i * row + j;
      const b = a + 1;
      const c = a + row + 1;
      const d = a + row;
      idx.push(a, b, c, a, c, d);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  orientOutward(geo, pts);
  if (caps) {
    // Flat ends, fanned.
    const p = geo.attributes.position.array;
    const P2 = Array.from(p);
    const U2 = Array.from(geo.attributes.uv.array);
    const I2 = Array.from(geo.index.array);
    for (const i of [0, pts.length - 1]) {
      const centre = P2.length / 3;
      P2.push(pts[i].x, pts[i].y, pts[i].z);
      U2.push(0.5, 0.8);
      const dirOut = i === 0 ? new THREE.Vector3().subVectors(pts[0], pts[1]) : new THREE.Vector3().subVectors(pts[i], pts[i - 1]);
      for (let j = 0; j < segments; j++) {
        const a = i * row + j;
        const b = a + 1;
        const va = new THREE.Vector3(P2[a * 3], P2[a * 3 + 1], P2[a * 3 + 2]).sub(pts[i]);
        const vb = new THREE.Vector3(P2[b * 3], P2[b * 3 + 1], P2[b * 3 + 2]).sub(pts[i]);
        if (va.cross(vb).dot(dirOut) >= 0) I2.push(centre, a, b);
        else I2.push(centre, b, a);
      }
    }
    geo.setAttribute('position', new THREE.Float32BufferAttribute(P2, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(U2, 2));
    geo.setIndex(I2);
  }
  geo.computeVertexNormals();
  return geo;
}

/** Make a tube's side faces point away from its path. */
function orientOutward(geo, pts) {
  const p = geo.attributes.position.array;
  const idx = geo.index.array;
  // Test the first quad: does its normal point away from the first point?
  const a = idx[0];
  const b = idx[1];
  const c = idx[2];
  const A = new THREE.Vector3(p[a * 3], p[a * 3 + 1], p[a * 3 + 2]);
  const B = new THREE.Vector3(p[b * 3], p[b * 3 + 1], p[b * 3 + 2]);
  const C = new THREE.Vector3(p[c * 3], p[c * 3 + 1], p[c * 3 + 2]);
  const n = new THREE.Vector3().subVectors(B, A).cross(new THREE.Vector3().subVectors(C, A));
  const mid = new THREE.Vector3().addVectors(pts[0], pts[1]).multiplyScalar(0.5);
  if (n.dot(A.clone().sub(mid)) < 0) {
    for (let i = 0; i < idx.length; i += 3) {
      const t = idx[i + 1];
      idx[i + 1] = idx[i + 2];
      idx[i + 2] = t;
    }
  }
}

/**
 * A propeller or rotor blade along +Y from the hub: a thin aerofoil section
 * lofted through radial stations with chord and twist, the way a real blade
 * is — broad near the root, narrowing to a rounded tip, and turning flatter
 * as it goes out. Chord lies along X at zero twist; thickness along Z.
 */
export function blade({ r0, r1, chord = 0.12, rootChord, tipChord, twistRoot = 0.7, twistTip = 0.2, t = 0.09, stations = 5, vTip = true }) {
  const nSec = 6;
  const sec = [];
  // A symmetric section, flat-ish: x across the chord (-0.5..0.5), z thickness.
  for (let i = 0; i < nSec; i++) {
    const a = (i / nSec) * TAU;
    const x = 0.5 * Math.cos(a);
    const xc = x + 0.5; // 0 at LE side
    const th = naThick(clamp(xc, 0, 1), t) * (Math.sin(a) >= 0 ? 1 : -1);
    sec.push([x, th]);
  }
  const rc = rootChord ?? chord * 0.75;
  const tc = tipChord ?? chord * 0.55;
  const pos = [];
  const uv = [];
  const idx = [];
  for (let k = 0; k <= stations; k++) {
    const f = k / stations;
    const r = lerp(r0, r1, f);
    // Chord peaks around a third of the way out, then narrows; the last
    // station is pinched to round the tip.
    const bulge = Math.sin(Math.min(1, f / 0.35) * Math.PI / 2);
    let c = lerp(rc, chord, bulge) * (f > 0.35 ? lerp(1, tc / chord, (f - 0.35) / 0.65) : 1);
    if (k === stations) c *= 0.45;
    const tw = lerp(twistRoot, twistTip, f);
    const ct = Math.cos(tw);
    const stw = Math.sin(tw);
    for (const [x, z] of sec) {
      const px = x * c;
      const pz = z * c;
      pos.push(px * ct - pz * stw, r, px * stw + pz * ct);
      uv.push(0.5 + x, vTip ? f : 0.5);
    }
  }
  for (let k = 0; k < stations; k++) {
    for (let i = 0; i < nSec; i++) {
      const a = k * nSec + i;
      const b = k * nSec + ((i + 1) % nSec);
      const c = (k + 1) * nSec + ((i + 1) % nSec);
      const d = (k + 1) * nSec + i;
      idx.push(a, b, c, a, c, d);
    }
  }
  // Close the tip.
  const last = stations * nSec;
  for (let i = 1; i < nSec - 1; i++) idx.push(last, last + i, last + i + 1);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  // Orientation: make faces point away from the blade axis.
  const p = geo.attributes.position.array;
  const [a, b, c] = idx;
  const A = new THREE.Vector3(p[a * 3], p[a * 3 + 1], p[a * 3 + 2]);
  const B = new THREE.Vector3(p[b * 3], p[b * 3 + 1], p[b * 3 + 2]);
  const C = new THREE.Vector3(p[c * 3], p[c * 3 + 1], p[c * 3 + 2]);
  const n = new THREE.Vector3().subVectors(B, A).cross(new THREE.Vector3().subVectors(C, A));
  if (n.dot(new THREE.Vector3(A.x, 0, A.z)) < 0) flipWinding(geo);
  else geo.computeVertexNormals();
  return geo;
}

/* ------------------------------------------------------------------ *
 * Batching
 * ------------------------------------------------------------------ */

/**
 * Merge many small parts into one geometry per material.
 *
 * Every aeroplane is a few dozen parts, and a draw call each is what makes a
 * Chromebook drop frames with three of them on the apron. Parts that never
 * move relative to each other are merged: add(geometry, material, matrix?),
 * then build(parent) makes one mesh per material. Geometries are consumed.
 */
export class Batch {
  constructor(name = 'batch') {
    this.name = name;
    this.map = new Map();
  }
  add(geo, material, matrix = null) {
    let g = geo.index ? geo : geo;
    if (matrix) g.applyMatrix4(matrix);
    if (!g.attributes.normal) g.computeVertexNormals();
    let list = this.map.get(material);
    if (!list) this.map.set(material, (list = []));
    list.push(g);
    return this;
  }
  /** Add a geometry placed by position / rotation / scale, like a mesh. */
  place(geo, material, { p = [0, 0, 0], r = [0, 0, 0], s = [1, 1, 1], q = null } = {}) {
    const m = new THREE.Matrix4();
    const quat = q || new THREE.Quaternion().setFromEuler(new THREE.Euler(r[0], r[1], r[2]));
    m.compose(new THREE.Vector3(p[0], p[1], p[2]), quat, new THREE.Vector3(s[0], s[1], s[2]));
    const det = m.determinant();
    this.add(geo, material, m);
    if (det < 0) flipWinding(geo);
    return this;
  }
  build(parent, { castShadow = true } = {}) {
    const meshes = [];
    for (const [material, list] of this.map) {
      const geo = mergeGeometries(list);
      const mesh = new THREE.Mesh(geo, material);
      mesh.name = `${this.name}`;
      mesh.castShadow = castShadow && !material.transparent;
      mesh.receiveShadow = !material.transparent;
      parent.add(mesh);
      meshes.push(mesh);
    }
    this.map.clear();
    return meshes;
  }
}

/** Concatenate indexed or non-indexed geometries with position/normal/uv. */
function mergeGeometries(list) {
  let nV = 0;
  let nI = 0;
  for (const g of list) {
    nV += g.attributes.position.count;
    nI += g.index ? g.index.count : g.attributes.position.count;
  }
  const pos = new Float32Array(nV * 3);
  const nor = new Float32Array(nV * 3);
  const uv = new Float32Array(nV * 2);
  const idx = nV > 65535 ? new Uint32Array(nI) : new Uint16Array(nI);
  let v = 0;
  let i = 0;
  for (const g of list) {
    const p = g.attributes.position;
    const n = g.attributes.normal;
    const u = g.attributes.uv;
    for (let k = 0; k < p.count; k++) {
      pos[(v + k) * 3] = p.getX(k);
      pos[(v + k) * 3 + 1] = p.getY(k);
      pos[(v + k) * 3 + 2] = p.getZ(k);
      nor[(v + k) * 3] = n.getX(k);
      nor[(v + k) * 3 + 1] = n.getY(k);
      nor[(v + k) * 3 + 2] = n.getZ(k);
      uv[(v + k) * 2] = u ? u.getX(k) : 0.5;
      uv[(v + k) * 2 + 1] = u ? u.getY(k) : 0.8;
    }
    if (g.index) {
      const a = g.index.array;
      for (let k = 0; k < a.length; k++) idx[i + k] = a[k] + v;
      i += a.length;
    } else {
      for (let k = 0; k < p.count; k++) idx[i + k] = v + k;
      i += p.count;
    }
    v += p.count;
    g.dispose();
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  geo.computeBoundingSphere();
  return geo;
}

/**
 * The inside of an airliner's nose, with its windows cut out exactly where
 * the outside has them.
 *
 * The airliners lay their flight-deck panes on the hull as quads in the
 * hull's own (z, s) — z along the aeroplane, s the angle round the section
 * from the top (models/airliner-parts.js glazing) — so a pane's edges are
 * straight lines in (z, s). Inside, the skin is a grid over (z, s) set in
 * from the outside by the skin's thickness, and every cell of it is clipped
 * against every pane: what lies inside the glass is cut away, what lies in
 * the band round it is the window frame, the rest is wall. Cells are convex
 * and so are the panes, so the clipping is exact (Sutherland-Hodgman), and
 * the openings are the panes' own edges — not stair-stepped, not "about
 * there".
 *
 * Also here: the reveal (the skin's thickness round each opening, inner edge
 * to glass) and the glass itself, for the rain.
 */

import * as THREE from '../../vendor/three.module.js';
import { offsetQuad, skinPatch } from '../models/airliner-parts.js';

/* ------------------------------------------------------------------ *
 * 2D convex clipping in (z, s)
 * ------------------------------------------------------------------ */

const cross = (a, b, p) => (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);

function area(poly) {
  let s = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    s += a[0] * b[1] - b[0] * a[1];
  }
  return s / 2;
}

/** The part of `poly` on the left of a->b (sign +1) or the right (-1). */
function clipHalf(poly, a, b, sign) {
  const out = [];
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % n];
    const cp = cross(a, b, p) * sign;
    const cq = cross(a, b, q) * sign;
    if (cp >= 0) out.push(p);
    if ((cp >= 0) !== (cq >= 0)) {
      const t = cp / (cp - cq);
      out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]);
    }
  }
  return out;
}

const ccw = (poly) => (area(poly) < 0 ? [...poly].reverse() : poly);
const bigEnough = (poly, eps) => poly.length >= 3 && Math.abs(area(poly)) > eps;

/** poly ∩ Q (Q convex, CCW). */
function intersect(poly, Q) {
  let out = poly;
  for (let i = 0; i < Q.length && out.length >= 3; i++) out = clipHalf(out, Q[i], Q[(i + 1) % Q.length], 1);
  return out;
}

/** poly \ Q as convex pieces (Q convex, CCW). */
function subtract(poly, Q, eps) {
  const pieces = [];
  let rest = poly;
  for (let i = 0; i < Q.length && rest.length >= 3; i++) {
    const a = Q[i];
    const b = Q[(i + 1) % Q.length];
    const outside = clipHalf(rest, a, b, -1);
    if (bigEnough(outside, eps)) pieces.push(outside);
    rest = clipHalf(rest, a, b, 1);
  }
  return pieces;
}

function bbox(poly) {
  let z0 = Infinity;
  let z1 = -Infinity;
  let s0 = Infinity;
  let s1 = -Infinity;
  for (const [z, s] of poly) {
    z0 = Math.min(z0, z);
    z1 = Math.max(z1, z);
    s0 = Math.min(s0, s);
    s1 = Math.max(s1, s);
  }
  return { z0, z1, s0, s1 };
}
const overlaps = (a, b) => a.z0 <= b.z1 && b.z0 <= a.z1 && a.s0 <= b.s1 && b.s0 <= a.s1;

/* ------------------------------------------------------------------ *
 * The skin
 * ------------------------------------------------------------------ */

/**
 * h       the hull (civil-kit hull(): point, normal, section, zMin, zMax)
 * quads   [{ quad: [[z, s] x4], frame }] right side, hull units
 * opts    { z0, z1, sMax, inset, cell (hull units), colourAt(p, kind) -> Color,
 *           frameColour }
 * Returns { geometry (vertex coloured, both sides), openings: [{ side, quad,
 * outer }] } — in hull units.
 */
export function deckSkin(h, quads, opts) {
  const { z0, z1, sMax, inset, cell } = opts;
  const colourAt = opts.colourAt || (() => new THREE.Color(0x9aa0a6));
  const frameColour = new THREE.Color(opts.frameColour || 0x2a2e33);
  // The scale of s: metres of skin per radian, at the middle. Cells are
  // `cell` long both ways.
  const zc = (z0 + z1) / 2;
  const sec = h.section(zc);
  const rS = Math.max(0.2, (sec.w + Math.max(sec.ht, sec.hb)) / 2);
  const nz = Math.max(4, Math.ceil((z1 - z0) / cell));
  const ns = Math.max(6, Math.ceil((sMax * rS) / cell));
  const eps = (cell * cell) / rS * 1e-4;
  const panes = quads.map((q) => {
    const G = ccw(q.quad.map((c) => [c[0], c[1]]));
    const O = ccw(offsetQuad(h, q.quad, q.frame).map((c) => [c[0], c[1]]));
    return { G, O, bG: bbox(G), bO: bbox(O) };
  });
  const pos = [];
  const nor = [];
  const col = [];
  const P = new THREE.Vector3();
  const N = new THREE.Vector3();
  const vert = (z, s, side, c) => {
    h.point(z, side * s, P);
    h.normal(z, side * s, N);
    pos.push(P.x - N.x * inset, P.y - N.y * inset, P.z - N.z * inset);
    nor.push(-N.x, -N.y, -N.z);
    col.push(c.r, c.g, c.b);
  };
  const _a = new THREE.Vector3();
  const _b = new THREE.Vector3();
  const _n = new THREE.Vector3();
  /** Fan a convex piece; wind each triangle to face inward (its normals). */
  const emit = (poly, side, kind) => {
    const base = pos.length / 3;
    for (const [z, s] of poly) {
      h.point(z, side * s, P);
      const c = kind === 'frame' ? frameColour : colourAt(P, kind);
      vert(z, s, side, c);
    }
    for (let i = 1; i < poly.length - 1; i++) {
      const ia = base;
      const ib = base + i;
      const ic = base + i + 1;
      // Face normal vs the vertex normal: swap so they agree.
      const ax = pos[ia * 3];
      const ay = pos[ia * 3 + 1];
      const az = pos[ia * 3 + 2];
      _a.set(pos[ib * 3] - ax, pos[ib * 3 + 1] - ay, pos[ib * 3 + 2] - az);
      _b.set(pos[ic * 3] - ax, pos[ic * 3 + 1] - ay, pos[ic * 3 + 2] - az);
      _n.crossVectors(_a, _b);
      const dot = _n.x * nor[ia * 3] + _n.y * nor[ia * 3 + 1] + _n.z * nor[ia * 3 + 2];
      tris.push(dot >= 0 ? [ia, ib, ic] : [ia, ic, ib]);
    }
  };
  const tris = [];
  for (const side of [1, -1]) {
    for (let i = 0; i < nz; i++) {
      const za = z0 + ((z1 - z0) * i) / nz;
      const zb = z0 + ((z1 - z0) * (i + 1)) / nz;
      for (let j = 0; j < ns; j++) {
        const sa = (sMax * j) / ns;
        const sb = (sMax * (j + 1)) / ns;
        const cellPoly = [[za, sa], [zb, sa], [zb, sb], [za, sb]];
        const cb = { z0: za, z1: zb, s0: sa, s1: sb };
        let pieces = [{ poly: cellPoly, kind: 'wall' }];
        for (const p of panes) {
          if (!overlaps(cb, p.bO)) continue;
          const next = [];
          for (const pc of pieces) {
            const outsideGlass = overlaps(bbox(pc.poly), p.bG) ? subtract(pc.poly, p.G, eps) : [pc.poly];
            for (const q of outsideGlass) {
              if (pc.kind === 'frame') {
                next.push({ poly: q, kind: 'frame' });
                continue;
              }
              const inFrame = intersect(q, p.O);
              if (bigEnough(inFrame, eps)) {
                next.push({ poly: inFrame, kind: 'frame' });
                for (const r of subtract(q, p.O, eps)) next.push({ poly: r, kind: 'wall' });
              } else next.push({ poly: q, kind: 'wall' });
            }
          }
          pieces = next;
        }
        for (const pc of pieces) emit(pc.poly, side, pc.kind);
      }
    }
  }
  const idx = [];
  for (const t of tris) idx.push(t[0], t[1], t[2]);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array((pos.length / 3) * 2), 2));
  g.setIndex(idx);
  return { geometry: g, panes };
}

/**
 * The reveal round every pane (skin thickness, from the inner skin to the
 * glass) and the glass itself, both sides. Hull units.
 */
export function revealsAndGlass(h, quads, { inset, glassOff = 0.02, steps = 6 }) {
  const pos = [];
  const idx = [];
  const P = new THREE.Vector3();
  const N = new THREE.Vector3();
  const at = (z, s, off) => {
    h.point(z, s, P);
    h.normal(z, s, N);
    return [P.x + N.x * off, P.y + N.y * off, P.z + N.z * off];
  };
  const glass = [];
  for (const side of [1, -1]) {
    for (const q of quads) {
      const c = q.quad;
      for (let e = 0; e < 4; e++) {
        const a = c[e];
        const b = c[(e + 1) % 4];
        const base = pos.length / 3;
        for (let i = 0; i <= steps; i++) {
          const t = i / steps;
          const z = a[0] + (b[0] - a[0]) * t;
          const s = side * (a[1] + (b[1] - a[1]) * t);
          pos.push(...at(z, s, -inset), ...at(z, s, glassOff));
        }
        for (let i = 0; i < steps; i++) {
          const p0 = base + i * 2;
          idx.push(p0, p0 + 1, p0 + 2, p0 + 1, p0 + 3, p0 + 2);
        }
      }
      glass.push(skinPatch(h, c, side, glassOff * 0.5, 4, 4));
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array((pos.length / 3) * 2), 2));
  return { reveals: g, glass };
}

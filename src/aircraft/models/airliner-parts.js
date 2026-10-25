/**
 * Airliner parts that sit ON a lofted hull (./civil-kit.js hull()): the
 * flight-deck glazing, doors that open, and the geometry helpers both need.
 *
 * Shared by the game's own Meridian (./meridian.js) and the fleet pack's
 * airliners (../../fleet/extra/airliner-kit.js). It lives here, beside the
 * civil kit, and imports nothing but Three and that kit, so model.js — the
 * fallback when the pack fails to load — never depends on the pack.
 *
 * Coordinates are the hull's: -Z forward, +Y up, +X right; `s` is the angle
 * round the section from the top centreline, positive to starboard. Units
 * are whatever the hull was built in (metres for the pack, shape units for
 * model.js, which scales the root afterwards).
 */
import * as THREE from '../../vendor/three.module.js';
import { tubePath } from './civil-kit.js';

const clamp = THREE.MathUtils.clamp;
const mix = (a, b, t) => a + (b - a) * t;

/* ------------------------------------------------------------------ *
 * Small geometry helpers
 * ------------------------------------------------------------------ */

/** Piecewise-linear map through [[x, y], ...], clamped. */
export function piecewise(knots) {
  return (x) => {
    if (x <= knots[0][0]) return knots[0][1];
    for (let i = 0; i < knots.length - 1; i++) {
      const [x0, y0] = knots[i];
      const [x1, y1] = knots[i + 1];
      if (x <= x1) return mix(y0, y1, (x - x0) / (x1 - x0 || 1));
    }
    return knots[knots.length - 1][1];
  };
}

/** Compact a sub-list of an indexed geometry's triangles into its own geometry. */
function subGeometry(src, tris) {
  const remap = new Map();
  const names = Object.keys(src.attributes);
  const out = Object.fromEntries(names.map((n) => [n, []]));
  const idx = [];
  for (const t of tris) {
    for (let k = 0; k < 3; k++) {
      const old = src.index.getX(t * 3 + k);
      let ni = remap.get(old);
      if (ni === undefined) {
        ni = remap.size;
        remap.set(old, ni);
        for (const n of names) {
          const a = src.attributes[n];
          for (let c = 0; c < a.itemSize; c++) out[n].push(a.array[old * a.itemSize + c]);
        }
      }
      idx.push(ni);
    }
  }
  const g = new THREE.BufferGeometry();
  for (const n of names) g.setAttribute(n, new THREE.Float32BufferAttribute(out[n], src.attributes[n].itemSize));
  g.setIndex(idx);
  return g;
}

/**
 * Cut a hull's geometry at the given z values: triangles go to the piece
 * their centroid is in. The cuts must be rings of the hull (pass them in its
 * `rings`) or a triangle straddles the line and the cut is ragged.
 */
export function splitByZ(geo, cuts) {
  const pos = geo.attributes.position;
  const n = geo.index.count / 3;
  const buckets = cuts.map(() => []).concat([[]]);
  for (let t = 0; t < n; t++) {
    let z = 0;
    for (let k = 0; k < 3; k++) z += pos.getZ(geo.index.getX(t * 3 + k));
    z /= 3;
    let b = 0;
    while (b < cuts.length && z > cuts[b]) b++;
    buckets[b].push(t);
  }
  return buckets.map((tris) => (tris.length ? subGeometry(geo, tris) : null));
}

/** The angle s (>= 0) at which the hull's right side is `x` out from the centreline, at height above the shoulder. */
function angleAtX(h, z, x) {
  let lo = 0;
  let hi = Math.PI / 2;
  const P = new THREE.Vector3();
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    h.point(z, mid, P);
    if (P.x < x) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/** A corner given as { z, s } | { z, y } | { z, x } — to [z, s] on the right side. */
export function cornerZS(h, c) {
  if (c.s !== undefined) return [c.z, c.s];
  if (c.x !== undefined) return [c.z, angleAtX(h, c.z, c.x)];
  return [c.z, h.angleAt(c.z, c.y)];
}

/** Surface metric at (z, s): metres per unit z and per radian of s. */
function metric(h, z, s) {
  const a = h.point(z + 0.01, s);
  const b = h.point(z - 0.01, s);
  const c = h.point(z, s + 0.005);
  const d = h.point(z, s - 0.005);
  return [a.distanceTo(b) / 0.02, c.distanceTo(d) / 0.01];
}

/**
 * Offset a convex quad given in (z, s) outward by `m` metres, using the
 * surface metric at its middle. Each edge moves out parallel to itself and
 * the new corners are where the moved edges meet.
 */
export function offsetQuad(h, quad, m) {
  const zc = quad.reduce((a, q) => a + q[0], 0) / quad.length;
  const sc = quad.reduce((a, q) => a + q[1], 0) / quad.length;
  const [ez, es] = metric(h, zc, sc);
  const P = quad.map(([z, s]) => [z * ez, s * es]);
  const C = [zc * ez, sc * es];
  const n = P.length;
  const lines = [];
  for (let i = 0; i < n; i++) {
    const a = P[i];
    const b = P[(i + 1) % n];
    let nx = b[1] - a[1];
    let ny = -(b[0] - a[0]);
    const l = Math.hypot(nx, ny) || 1;
    nx /= l;
    ny /= l;
    // Outward: away from the centre.
    if ((a[0] - C[0]) * nx + (a[1] - C[1]) * ny < 0) {
      nx = -nx;
      ny = -ny;
    }
    lines.push({ p: [a[0] + nx * m, a[1] + ny * m], d: [b[0] - a[0], b[1] - a[1]] });
  }
  const out = [];
  for (let i = 0; i < n; i++) {
    const L1 = lines[(i + n - 1) % n];
    const L2 = lines[i];
    const det = L1.d[0] * -L2.d[1] - L1.d[1] * -L2.d[0];
    let x;
    let y;
    if (Math.abs(det) < 1e-9) {
      x = L2.p[0];
      y = L2.p[1];
    } else {
      const rx = L2.p[0] - L1.p[0];
      const ry = L2.p[1] - L1.p[1];
      const t = (rx * -L2.d[1] - ry * -L2.d[0]) / det;
      x = L1.p[0] + L1.d[0] * t;
      y = L1.p[1] + L1.d[1] * t;
    }
    out.push([x / ez, y / es]);
  }
  return out;
}

/**
 * A patch laid on the hull over a quad in (z, s), `off` metres out along the
 * skin's normal, on one side (+1 starboard, -1 port). Bilinear in (z, s), so
 * any four corners make a sensible window. Wound to face outward.
 */
export function skinPatch(h, quad, side, off, nu, nv, uvOf) {
  const pos = [];
  const nor = [];
  const uv = [];
  const idx = [];
  const P = new THREE.Vector3();
  const N = new THREE.Vector3();
  const [a, b, c, d] = quad;
  for (let j = 0; j <= nv; j++) {
    const v = j / nv;
    for (let i = 0; i <= nu; i++) {
      const u = i / nu;
      const z = mix(mix(a[0], b[0], u), mix(d[0], c[0], u), v);
      const s = mix(mix(a[1], b[1], u), mix(d[1], c[1], u), v);
      h.point(z, side * s, P);
      h.normal(z, side * s, N);
      pos.push(P.x + N.x * off, P.y + N.y * off, P.z + N.z * off);
      nor.push(N.x, N.y, N.z);
      if (uvOf) uv.push(...uvOf(z, s));
      else uv.push(u, v);
    }
  }
  const row = nu + 1;
  for (let j = 0; j < nv; j++) {
    for (let i = 0; i < nu; i++) {
      const p0 = j * row + i;
      idx.push(p0, p0 + 1, p0 + row + 1, p0, p0 + row + 1, p0 + row);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  orientOutward(g);
  return g;
}

/** Wind every triangle so its face agrees with its vertex normals. */
export function orientOutward(g) {
  const p = g.attributes.position.array;
  const n = g.attributes.normal.array;
  const ix = g.index.array;
  for (let i = 0; i < ix.length; i += 3) {
    const a = ix[i] * 3;
    const b = ix[i + 1] * 3;
    const c = ix[i + 2] * 3;
    const e1x = p[b] - p[a], e1y = p[b + 1] - p[a + 1], e1z = p[b + 2] - p[a + 2];
    const e2x = p[c] - p[a], e2y = p[c + 1] - p[a + 1], e2z = p[c + 2] - p[a + 2];
    const fx = e1y * e2z - e1z * e2y;
    const fy = e1z * e2x - e1x * e2z;
    const fz = e1x * e2y - e1y * e2x;
    const nx = n[a] + n[b] + n[c];
    const ny = n[a + 1] + n[b + 1] + n[c + 1];
    const nz = n[a + 2] + n[b + 2] + n[c + 2];
    if (fx * nx + fy * ny + fz * nz < 0) {
      const t = ix[i + 1];
      ix[i + 1] = ix[i + 2];
      ix[i + 2] = t;
    }
  }
  g.index.needsUpdate = true;
  return g;
}

/** Merge geometries that share one attribute layout (position, normal, uv). */
export function mergeGeometries(list) {
  const pos = [];
  const nor = [];
  const uv = [];
  const idx = [];
  let base = 0;
  for (const g of list) {
    if (!g) continue;
    const p = g.attributes.position;
    if (!g.attributes.normal) g.computeVertexNormals();
    const n = g.attributes.normal;
    const t = g.attributes.uv;
    for (let i = 0; i < p.count; i++) {
      pos.push(p.getX(i), p.getY(i), p.getZ(i));
      nor.push(n.getX(i), n.getY(i), n.getZ(i));
      uv.push(t ? t.getX(i) : 0, t ? t.getY(i) : 0);
    }
    if (g.index) for (let i = 0; i < g.index.count; i++) idx.push(base + g.index.getX(i));
    else for (let i = 0; i < p.count; i++) idx.push(base + i);
    base += p.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  out.setIndex(idx);
  return out;
}

export function remapUV(geo, along, vMap = null) {
  const p = geo.attributes.position;
  const uv = geo.attributes.uv;
  for (let i = 0; i < p.count; i++) {
    uv.setX(i, along(p.getZ(i)));
    if (vMap) uv.setY(i, vMap(uv.getY(i)));
  }
  uv.needsUpdate = true;
}

/* ------------------------------------------------------------------ *
 * Flight-deck glazing
 * ------------------------------------------------------------------ */

/**
 * The windscreen and side windows: for each pane a black frame laid on the
 * skin, the glass a little proud of it, and a wiper on each front pane.
 *
 * panes: [{ name, corners: [c0, c1, c2, c3], wiper?: true }], corners as
 * { z, y } | { z, x } | { z, s }, going round the pane; right side, mirrored.
 * Returns the geometries (frames, glass, wipers) and the outline of every
 * pane in metres — what the cockpit builder needs to put its own frames
 * exactly where these are.
 *
 * Both glass and frames face out only, so from the flight deck they are
 * culled and the view out is clear (the cockpit draws its own frames).
 */
export function glazing(h, panes, { frame = 0.07, frameOff = 0.012, glassOff = 0.024, wiperLength = 0.55, unit = 1, frameGrid = [4, 4], glassGrid = [4, 6] } = {}) {
  // `unit`: metres per hull unit, for the parts drawn to a fixed size (the wipers).
  const k = 1 / unit;
  const frames = [];
  const glass = [];
  const wipers = [];
  const outlines = [];
  // Each pane in the hull's own (z, s), right side, with its frame's width:
  // what the cockpit cuts its window openings on (cockpit/flightdeck.js).
  const quads = [];
  const P = new THREE.Vector3();
  const N = new THREE.Vector3();
  for (const pane of panes) {
    const quad = pane.corners.map((c) => cornerZS(h, c));
    quads.push({ name: pane.name, quad, frame: pane.frame ?? frame, glassOff, frameOff });
    const outer = offsetQuad(h, quad, pane.frame ?? frame);
    for (const side of [1, -1]) {
      frames.push(skinPatch(h, outer, side, frameOff, frameGrid[0], frameGrid[1]));
      glass.push(skinPatch(h, quad, side, glassOff, glassGrid[0], glassGrid[1]));
      const pts = quad.map(([z, s]) => {
        h.point(z, side * s, P);
        h.normal(z, side * s, N);
        return [+(P.x + N.x * glassOff).toFixed(3), +(P.y + N.y * glassOff).toFixed(3), +P.z.toFixed(3)];
      });
      outlines.push({ name: `${pane.name} ${side > 0 ? 'right' : 'left'}`, side: side > 0 ? 'right' : 'left', corners: pts });
      if (pane.wiper) {
        // Parked along the bottom of the pane: pivot outboard, blade lying
        // towards the centre post, just above the frame. Corners 0 and 1
        // are the bottom edge, inboard to outboard; (u, v) is the pane's own
        // bilinear parameter, v = 0 at the bottom.
        const [a, b, c, d] = quad;
        const at = (u, v, lift) => {
          const z = mix(mix(a[0], b[0], u), mix(d[0], c[0], u), v);
          const s = mix(mix(a[1], b[1], u), mix(d[1], c[1], u), v);
          h.point(z, side * s, P);
          h.normal(z, side * s, N);
          return new THREE.Vector3(P.x + N.x * (glassOff + lift), P.y + N.y * (glassOff + lift), P.z + N.z * (glassOff + lift));
        };
        const pivot = at(0.88, 0.07, 0.035 * k);
        const tip = at(Math.max(0.05, 0.88 - wiperLength), 0.11, 0.02 * k);
        const elbow = at(0.8, 0.08, 0.05 * k);
        wipers.push(tubePath([pivot, elbow, tip], [0.022 * k, 0.016 * k, 0.012 * k], 5));
        // The blade, along the arm's outer half.
        const b0 = pivot.clone().lerp(tip, 0.45);
        wipers.push(tubePath([b0, tip.clone().lerp(pivot, -0.04)], 0.009 * k, 4));
        // The pivot cap.
        const cap = new THREE.CylinderGeometry(0.035 * k, 0.04 * k, 0.03 * k, 8);
        cap.translate(pivot.x, pivot.y, pivot.z);
        wipers.push(cap);
      }
    }
  }
  return {
    frames: mergeGeometries(frames),
    glass: mergeGeometries(glass),
    wipers: wipers.length ? mergeGeometries(wipers.map(toNonIndexedSafe)) : null,
    outlines,
    quads,
  };
}

function toNonIndexedSafe(g) {
  if (!g.attributes.normal) g.computeVertexNormals();
  if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
  return g;
}

/* ------------------------------------------------------------------ *
 * Doors
 * ------------------------------------------------------------------ */

/**
 * Doors that open: each a named group on its hinge, a leaf that pops out
 * and swings forward along the skin the way an airliner's plug door does,
 * and the dark doorway behind it. Closed, both are hidden and the painted
 * outline is the door — so a closed door costs nothing to draw.
 *
 * list: [{ id, side: 'left'|'right', z, y, w, h, kind, deck, sill, hull }]
 *   z, y   the door's middle; w, h its width and height; sill the floor
 *   hull   the loft it is cut in
 * uvOf(hull, z, s, side) -> [u, v]: how that loft maps its paint, so the
 * leaf wears exactly what the skin round it does.
 * scale: metres per hull unit (the records are in metres).
 * Returns the API the model carries as userData.doors (see doorApi).
 */
export function buildDoors({ list, parentFor, materials, uvOf, own, scale = 1, swing = 2.85 }) {
  const records = [];
  const P = new THREE.Vector3();
  const N = new THREE.Vector3();
  // Sizes in metres, in the hull's own units.
  const k = 1 / scale;
  const skinOut = 0.006 * k;
  const lining = -0.09 * k;
  for (const d of list) {
    const h = d.hull;
    const side = d.side === 'right' ? 1 : -1;
    const z0 = d.z - d.w / 2;
    const z1 = d.z + d.w / 2;
    const yTop = d.y + d.h / 2;
    const yBot = d.y - d.h / 2;
    // The door's rectangle in (z, s): s from its top edge to its sill.
    const sAt = (z, y) => h.angleAt(z, y);
    const quad = [[z0, sAt(z0, yTop)], [z1, sAt(z1, yTop)], [z1, sAt(z1, yBot)], [z0, sAt(z0, yBot)]];
    const group = new THREE.Group();
    group.name = `Door ${d.id}`;
    // Hinge: on the forward edge at half height, a little outboard (the
    // hinge arm), so the leaf clears the skin as it swings.
    const sMid = sAt(d.z, d.y);
    h.point(z0, side * sAt(z0, d.y), P);
    h.normal(z0, side * sAt(z0, d.y), N);
    const arm = 0.16 * (d.w / 1.0);
    const hinge = P.clone().addScaledVector(N.clone().setZ(0).normalize(), arm);
    group.position.copy(hinge);
    const leaf = new THREE.Group();
    leaf.name = `Door ${d.id} leaf`;
    group.add(leaf);
    // Outer skin of the leaf: the livery, mapped as the fuselage is mapped.
    const outer = skinPatch(h, quad, side, skinOut, 3, 5, uvOf ? (z, s) => uvOf(h, z, s, side) : null);
    outer.translate(-hinge.x, -hinge.y, -hinge.z);
    // Its inside: the lining, set in by the door's thickness.
    const inner = skinPatch(h, quad, side, lining, 2, 3);
    flip(inner);
    inner.translate(-hinge.x, -hinge.y, -hinge.z);
    const edge = doorEdges(h, quad, side, skinOut, lining);
    edge.translate(-hinge.x, -hinge.y, -hinge.z);
    const mkMesh = (name, geo, mat, parent) => {
      const m = new THREE.Mesh(own(geo), mat);
      m.name = name;
      m.castShadow = true;
      m.receiveShadow = true;
      m.userData.dynamic = true;
      parent.add(m);
      return m;
    };
    const leafSkin = mkMesh(`Door ${d.id} skin`, outer, materials.skin, leaf);
    const leafLining = mkMesh(`Door ${d.id} lining`, mergeGeometries([inner, edge]), materials.interior, leaf);
    // The doorway: a dark panel just inside the outline, on the skin.
    const inset = offsetQuad(h, quad, -0.035 * k);
    const way = skinPatch(h, inset, side, 0.003 * k, 2, 4);
    way.translate(-hinge.x, -hinge.y, -hinge.z);
    const doorway = mkMesh(`Door ${d.id} opening`, way, materials.opening, group);
    doorway.castShadow = false;
    leaf.visible = false;
    doorway.visible = false;
    const parent = parentFor(d);
    parent.add(group);
    // The outward normal at the door's middle, flattened, for whoever
    // stands people in the doorway.
    h.normal(d.z, side * sMid, N);
    h.point(d.z, side * sMid, P);
    const rec = {
      id: d.id,
      side: d.side,
      deck: d.deck || 'main',
      kind: d.kind || 'passenger',
      x: +(P.x * scale).toFixed(3),
      y: +(d.y * scale).toFixed(3),
      z: +(d.z * scale).toFixed(3),
      w: +(d.w * scale).toFixed(3),
      h: +(d.h * scale).toFixed(3),
      sill: +((d.sill ?? yBot) * scale).toFixed(3),
      normal: [+N.x.toFixed(3), +N.y.toFixed(3), 0],
    };
    records.push({ rec, group, leaf, doorway, side, popDir: N.clone().setZ(0).normalize().multiplyScalar(k), t: 0, target: 0, speed: 0.5 });
  }
  return doorApi(records, swing);
}

function flip(g) {
  const ix = g.index.array;
  for (let i = 0; i < ix.length; i += 3) {
    const t = ix[i + 1];
    ix[i + 1] = ix[i + 2];
    ix[i + 2] = t;
  }
  const n = g.attributes.normal;
  for (let i = 0; i < n.count; i++) n.setXYZ(i, -n.getX(i), -n.getY(i), -n.getZ(i));
}

/** The four edges of a door leaf between its outer skin and its lining. */
function doorEdges(h, quad, side, offOut, offIn) {
  const pos = [];
  const P = new THREE.Vector3();
  const N = new THREE.Vector3();
  const steps = 4;
  const ring = [];
  for (let e = 0; e < 4; e++) {
    const a = quad[e];
    const b = quad[(e + 1) % 4];
    for (let i = 0; i < steps; i++) {
      const t = i / steps;
      ring.push([mix(a[0], b[0], t), mix(a[1], b[1], t)]);
    }
  }
  const idx = [];
  const ptsOut = [];
  const ptsIn = [];
  for (const [z, s] of ring) {
    h.point(z, side * s, P);
    h.normal(z, side * s, N);
    ptsOut.push([P.x + N.x * offOut, P.y + N.y * offOut, P.z + N.z * offOut]);
    ptsIn.push([P.x + N.x * offIn, P.y + N.y * offIn, P.z + N.z * offIn]);
  }
  const n = ring.length;
  for (let i = 0; i < n; i++) {
    pos.push(...ptsOut[i], ...ptsIn[i]);
  }
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    idx.push(i * 2, j * 2, j * 2 + 1, i * 2, j * 2 + 1, i * 2 + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array((pos.length / 3) * 2), 2));
  return g;
}

/**
 * The doors' control surface, carried as model.userData.doors:
 *
 *   list                    door records: id, side, deck, kind, x, y, z, w, h,
 *                           sill, normal — metres, the model's own frame
 *   open(id, {instant})     swing it open (about two seconds); 'all' for every one
 *   close(id, {instant})
 *   set(id, t)              0 shut .. 1 fully open, at once
 *   amount(id)              where it is now, 0..1
 *   node(id)                the door's group (its hinge)
 *   worldPosition(model, id, out)  the doorway's middle in the world
 *   update(dt)              eased by the model's own update; nothing to call
 */
function doorApi(records, swing) {
  const byId = new Map(records.map((r) => [r.rec.id, r]));
  const pose = (r) => {
    const t = clamp(r.t, 0, 1);
    const shown = t > 0.001;
    r.leaf.visible = shown;
    r.doorway.visible = shown;
    // 0-0.2: the plug door moves out of its frame; 0.2-1: it swings
    // forward round its hinge arm until it lies along the skin.
    const pop = clamp(t / 0.2, 0, 1);
    const turn = clamp((t - 0.2) / 0.8, 0, 1);
    const ease = turn * turn * (3 - 2 * turn);
    r.leaf.position.copy(r.popDir).multiplyScalar(0.07 * pop);
    // Positive rotation about Y swings the aft edge towards +X; a port door
    // swings out to -X.
    r.leaf.rotation.y = (r.side > 0 ? 1 : -1) * swing * ease;
  };
  const ids = (id) => (id === 'all' || id === undefined ? [...byId.keys()] : Array.isArray(id) ? id : [id]);
  const api = {
    list: records.map((r) => r.rec),
    open(id, { instant = false } = {}) {
      for (const k of ids(id)) {
        const r = byId.get(k);
        if (!r) continue;
        r.target = 1;
        if (instant) {
          r.t = 1;
          pose(r);
        }
      }
    },
    close(id, { instant = false } = {}) {
      for (const k of ids(id)) {
        const r = byId.get(k);
        if (!r) continue;
        r.target = 0;
        if (instant) {
          r.t = 0;
          pose(r);
        }
      }
    },
    set(id, t) {
      for (const k of ids(id)) {
        const r = byId.get(k);
        if (!r) continue;
        r.t = r.target = clamp(t, 0, 1);
        pose(r);
      }
    },
    amount(id) {
      const r = byId.get(id);
      return r ? r.t : 0;
    },
    node(id) {
      const r = byId.get(id);
      return r ? r.group : null;
    },
    /** The middle of the doorway, in the world, given the model it is on. */
    worldPosition(model, id, out = new THREE.Vector3()) {
      const r = byId.get(id);
      if (!r || !model) return null;
      model.updateWorldMatrix(true, false);
      const s = model.scale.x || 1;
      return out.set(r.rec.x / s, r.rec.y / s, r.rec.z / s).applyMatrix4(model.matrixWorld);
    },
    update(dt) {
      if (!(dt > 0)) return;
      for (const r of records) {
        if (r.t === r.target) continue;
        const step = dt * r.speed;
        r.t = r.target > r.t ? Math.min(r.target, r.t + step) : Math.max(r.target, r.t - step);
        pose(r);
      }
    },
  };
  return api;
}


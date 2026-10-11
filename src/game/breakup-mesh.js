/**
 * The break zones, applied to a DRAWN model — any of them: model.js's
 * lathes, the civil team's hulls, the fleet pack's lofts, the Blender
 * helicopter, T-Pose Harrison.
 *
 *   surveyModel(model, opts)       what is drawn, measured in body metres:
 *                                  every mesh with its transform and a hint
 *                                  of what part it is (the fleet pack's
 *                                  strike ids, part names like "rudder" or
 *                                  "rotor head"); the airframe's true length
 *                                  and span; the fuselage station by station
 *   classifyModel(survey, layout)  every TRIANGLE of every mesh into a zone,
 *                                  by its centroid (src/game/breakup.js
 *                                  classify). Triangles that cross a zone
 *                                  boundary — the wing's root, its outer-
 *                                  inner split, the nose and rear sections —
 *                                  are CUT along it first, so a low-poly wing
 *                                  whose triangles run root to tip still
 *                                  breaks along a clean line rather than as a
 *                                  fan of slivers. Merged geometry is split,
 *                                  never guessed at.
 *   breakZones(asg, pieces, opts)  take those zones off the model: each piece
 *                                  becomes its own Group of new meshes (the
 *                                  zone's triangles, baked into metres around
 *                                  the piece's centre, same materials), and
 *                                  the model's meshes are given a geometry
 *                                  with those triangles left out
 *   deformZones(asg, actions, hit) bend, crush and fold what stays on
 *   restoreModel(model)            put everything back exactly as built
 *
 * NOTHING HERE EDITS A MODEL BUILDER OR A SHARED GEOMETRY. A broken mesh is
 * handed a NEW geometry (its own copy of every attribute, so disposing it can
 * never pull a buffer out from under another aircraft drawn from the same
 * geometry — the Blender helicopters share theirs), and the original is kept
 * to hand back. Restoring is a reference swap.
 *
 * Pure three.js: no DOM, no scene needed — tests/features/breakup.mjs builds
 * every aircraft in node and splits it.
 */

import * as THREE from '../vendor/three.module.js';
import { ZONES, CORE, bodyAt } from './breakup.js';

/* ------------------------------------------------------------------ *
 * Hints: what part a mesh says it is
 * ------------------------------------------------------------------ */

const STRIKE_HINT = {
  leftWing: 'wing', rightWing: 'wing', leftAileron: 'wing', rightAileron: 'wing', leftFlap: 'wing', rightFlap: 'wing',
  nose: 'body', canopy: 'body', cockpit: 'body', fuselage: 'body', leftIntake: 'body', rightIntake: 'body', liftFan: 'body',
  arrestorHook: 'tail', tail: 'tail', verticalFin: 'fin', leftElevator: 'tailplane', rightElevator: 'tailplane',
  noseGear: 'gear', leftGear: 'gear', rightGear: 'gear', leftBodyGear: 'gear', rightBodyGear: 'gear',
};

/** Names, nearest first: the mesh's own, then each parent's up to the model. */
const NAME_HINTS = [
  [/tail ?rotor|rotor_tail/i, 'tailRotor'],
  [/rotor head|rotor hub|rotor blade|main rotor|rotor_main|rotor disc/i, 'rotor'],
  [/propell|spinner|prop blade|^prop_/i, 'prop'],
  [/aileron|flap|slat|winglet|wing/i, 'wing'],
  [/elevator|tailplane|stabili[sz]er/i, 'tailplane'],
  [/rudder|vertical fin|^fin\b/i, 'fin'],
  [/^fuselage$|radome|^hull$/i, 'body'],
];
/** Gear by name beats everything: the airliners hang their main gear under the engine's part. */
const GEAR_NAME = /landing gear|main gear|nose gear|skid gear|oleo|axle|nose fork|wheel|tyre|tire|gear door/i;

/** Drawn for the look of a moment — a blur disc, a vapour cone — never a piece of airframe. */
const EFFECT_NAME = /disc|blur|cone|glow|flame|plume|vapou?r|shock|halo|beam|spot ?light|shadow/i;

function hintFor(obj, root) {
  for (let n = obj; n && n !== root; n = n.parent) if (GEAR_NAME.test(n.name || '')) return 'gear';
  for (let n = obj; n && n !== root; n = n.parent) {
    const id = n.userData && n.userData.strikeId;
    if (id) {
      if (STRIKE_HINT[id]) return STRIKE_HINT[id];
      if (/Propeller$/.test(id)) return 'prop';
      if (/Engine$/.test(id) || id === 'engine') return 'engine';
    }
  }
  for (let n = obj; n && n !== root; n = n.parent) {
    const name = n.name || '';
    if (!name) continue;
    for (const [re, h] of NAME_HINTS) if (re.test(name)) return h;
  }
  return null;
}

function isEffect(obj, root) {
  const mats = Array.isArray(obj.material) ? obj.material : obj.material ? [obj.material] : [];
  if (!mats.length) return true;
  const allTransparent = mats.every((m) => m.transparent);
  if (allTransparent && mats.every((m) => m.opacity < 0.25 || m.blending === THREE.AdditiveBlending || (m.depthWrite === false && m.opacity < 0.35))) return true;
  for (let n = obj; n && n !== root; n = n.parent) if (EFFECT_NAME.test(n.name || '')) return allTransparent || /disc|blur/i.test(n.name);
  return false;
}

/* ------------------------------------------------------------------ *
 * Survey
 * ------------------------------------------------------------------ */

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _m = new THREE.Matrix4();

/**
 * @param model   the aircraft's root Object3D
 * @param opts.skip  objects whose subtrees are not airframe (the cockpit panel main.js hangs on it)
 */
export function surveyModel(model, opts = {}) {
  model.updateMatrixWorld(true);
  const skip = opts.skip || new Set();
  const scale = model.getWorldScale(_v).x || 1;
  const toBody = new THREE.Matrix4().makeScale(scale, scale, scale).multiply(model.matrixWorld.clone().invert());
  const entries = [];
  const walk = (o) => {
    if (skip.has(o)) return;
    if (o !== model && (o.isLight || o.isCamera)) return;
    if (o.isMesh || o.isSprite) {
      const M = toBody.clone().multiply(o.matrixWorld);
      if (o.isSprite) entries.push({ obj: o, kind: 'sprite', M, hint: null, effect: false });
      else {
        const effect = isEffect(o, model);
        const g = o.geometry;
        if (g && g.attributes && g.attributes.position && !o.isSkinnedMesh) {
          entries.push({ obj: o, kind: o.isInstancedMesh ? 'instanced' : 'mesh', M, hint: effect ? null : hintFor(o, model), effect, geometry: g });
        }
      }
    }
    for (const c of o.children) walk(c);
  };
  walk(model);

  // The airframe's own extent: opaque, not rotor, not an effect.
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  const body = [];
  const rotor = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity], n: 0 };
  const tailRotor = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity], n: 0 };
  let tailplaneX = 0;
  const grow = (b, x, y, z) => {
    if (x < b.min[0]) b.min[0] = x;
    if (y < b.min[1]) b.min[1] = y;
    if (z < b.min[2]) b.min[2] = z;
    if (x > b.max[0]) b.max[0] = x;
    if (y > b.max[1]) b.max[1] = y;
    if (z > b.max[2]) b.max[2] = z;
  };
  const bbox = { min, max };
  for (const e of entries) {
    if (e.kind === 'sprite' || e.effect) continue;
    const pos = e.geometry.attributes.position;
    const instances = e.kind === 'instanced' ? e.obj.count : 1;
    for (let k = 0; k < instances; k++) {
      const M = e.kind === 'instanced' ? _m.multiplyMatrices(e.M, instMatrix(e.obj, k)) : e.M;
      const step = pos.count > 4000 ? 3 : 1;
      for (let i = 0; i < pos.count; i += step) {
        _w.fromBufferAttribute(pos, i).applyMatrix4(M);
        if (e.hint === 'rotor') {
          grow(rotor, _w.x, _w.y, _w.z);
          rotor.n++;
          continue;
        }
        if (e.hint === 'tailRotor') {
          grow(tailRotor, _w.x, _w.y, _w.z);
          tailRotor.n++;
        }
        grow(bbox, _w.x, _w.y, _w.z);
        if (e.hint === 'body' && e.kind === 'mesh') body.push(_w.x, _w.y, _w.z);
        if (e.hint === 'tailplane') tailplaneX = Math.max(tailplaneX, Math.abs(_w.x));
      }
    }
  }
  const out = { model, scale, toBody, entries, bbox: Number.isFinite(min[0]) ? bbox : null };
  if (body.length >= 30) out.body = bodyProfile(body);
  if (rotor.n) {
    const cx = (rotor.min[0] + rotor.max[0]) / 2;
    const cz = (rotor.min[2] + rotor.max[2]) / 2;
    out.rotor = { x: cx, y: rotor.min[1], z: cz, r: Math.max(rotor.max[0] - cx, rotor.max[2] - cz) };
  }
  if (tailRotor.n) {
    const c = [0, 1, 2].map((i) => (tailRotor.min[i] + tailRotor.max[i]) / 2);
    out.tailRotor = { x: c[0], y: c[1], z: c[2], r: Math.max(0.3, 0.5 * Math.max(tailRotor.max[1] - tailRotor.min[1], tailRotor.max[2] - tailRotor.min[2])) };
  }
  if (tailplaneX > 0) out.tailplaneX = tailplaneX;
  return out;
}

function instMatrix(mesh, k) {
  const m = new THREE.Matrix4();
  mesh.getMatrixAt(k, m);
  return m;
}

/** The fuselage, station by station, from the vertices of the meshes that are it. */
function bodyProfile(xyz) {
  let z0 = Infinity;
  let z1 = -Infinity;
  for (let i = 2; i < xyz.length; i += 3) {
    z0 = Math.min(z0, xyz[i]);
    z1 = Math.max(z1, xyz[i]);
  }
  const N = 24;
  const dz = (z1 - z0) / N || 1;
  const bins = Array.from({ length: N }, () => ({ w: 0, top: -Infinity, bot: Infinity, n: 0 }));
  for (let i = 0; i < xyz.length; i += 3) {
    const b = bins[Math.max(0, Math.min(N - 1, Math.floor((xyz[i + 2] - z0) / dz)))];
    b.w = Math.max(b.w, Math.abs(xyz[i]));
    b.top = Math.max(b.top, xyz[i + 1]);
    b.bot = Math.min(b.bot, xyz[i + 1]);
    b.n++;
  }
  const out = [];
  bins.forEach((b, i) => {
    if (b.n) out.push({ z: z0 + (i + 0.5) * dz, w: b.w, top: b.top, bot: b.bot });
  });
  return out;
}

/* ------------------------------------------------------------------ *
 * Raw geometry access
 * ------------------------------------------------------------------ */

function triCount(g) {
  return Math.floor((g.index ? g.index.count : g.attributes.position.count) / 3);
}
function triVert(g, t, k) {
  return g.index ? g.index.getX(t * 3 + k) : t * 3 + k;
}
/** A view of an attribute's raw values (normalised stays normalised). */
function rawOf(src) {
  const inter = src.isInterleavedBufferAttribute;
  return { raw: inter ? src.data.array : src.array, stride: inter ? src.data.stride : src.itemSize, offset: inter ? src.offset : 0, size: src.itemSize };
}

/* ------------------------------------------------------------------ *
 * Cutting along the zone boundaries
 * ------------------------------------------------------------------ */

/** The planes zones meet on, in body metres: [axis 0 = x | 2 = z, value]. */
export function cutPlanes(layout) {
  const f = layout.frame;
  const out = [];
  if (Number.isFinite(f.noseSplit)) out.push([2, f.noseSplit]);
  if (Number.isFinite(f.rearSplit)) out.push([2, f.rearSplit]);
  if (f.wing && f.family !== 'person') {
    const root = Math.max(f.wing.rootX || 0, Math.max(...f.profile.map((p) => p.w)) * 1.12);
    for (const s of [-1, 1]) {
      out.push([0, s * root]);
      if (Number.isFinite(f.wing.splitX) && f.family !== 'rotor') out.push([0, s * f.wing.splitX]);
    }
  }
  return out;
}

/**
 * The geometry with every triangle that crosses one of the planes split along
 * it, new vertices interpolated in every attribute and shared between the two
 * triangles either side of a cut edge (so the cut has no cracks). Indexed, its
 * own attributes. null if nothing crossed, so the caller keeps the original.
 */
export function cutGeometry(g, M, planes) {
  const e = M.elements;
  const n = triCount(g);
  const P = rawOf(g.attributes.position);
  const V = g.attributes.position.count;
  const EPS = 1e-5;
  const np = planes.length;
  // Each vertex's distance to each plane, once.
  const D = new Float64Array(V * np);
  for (let i = 0; i < V; i++) {
    const b = i * P.stride + P.offset;
    const x = P.raw[b];
    const y = P.raw[b + 1];
    const z = P.raw[b + 2];
    for (let p = 0; p < np; p++) {
      const axis = planes[p][0];
      D[i * np + p] = e[axis] * x + e[4 + axis] * y + e[8 + axis] * z + e[12 + axis] - planes[p][1];
    }
  }
  let crosses = false;
  for (let t = 0; t < n && !crosses; t++) {
    const i0 = triVert(g, t, 0) * np;
    const i1 = triVert(g, t, 1) * np;
    const i2 = triVert(g, t, 2) * np;
    for (let p = 0; p < np; p++) {
      const a = D[i0 + p];
      const b = D[i1 + p];
      const c = D[i2 + p];
      if ((a < -EPS || b < -EPS || c < -EPS) && (a > EPS || b > EPS || c > EPS)) {
        crosses = true;
        break;
      }
    }
  }
  if (!crosses) return null;

  // Original vertices stay where they are; the cuts' new ones go in `extra`.
  const views = Object.keys(g.attributes).map((nm) => ({ name: nm, ...rawOf(g.attributes[nm]), normalized: g.attributes[nm].normalized }));
  const extra = views.map(() => []);
  const extraD = [];
  let count = V;
  const comp = (vi, a, k) => {
    const v = views[a];
    return vi < V ? v.raw[vi * v.stride + v.offset + k] : extra[a][(vi - V) * v.size + k];
  };
  const dist = (vi, p) => (vi < V ? D[vi * np + p] : extraD[(vi - V) * np + p]);
  const edges = new Map();
  const split = (i, j, s, p) => {
    const key = (Math.min(i, j) * 4194304 + Math.max(i, j)) * 8 + p;
    let id = edges.get(key);
    if (id !== undefined) return id;
    id = count++;
    for (let a = 0; a < views.length; a++) {
      const sz = views[a].size;
      for (let k = 0; k < sz; k++) {
        const x = comp(i, a, k);
        extra[a].push(x + (comp(j, a, k) - x) * s);
      }
    }
    for (let q = 0; q < np; q++) {
      const x = dist(i, q);
      extraD.push(x + (dist(j, q) - x) * s);
    }
    edges.set(key, id);
    return id;
  };
  const groups = g.groups && g.groups.length ? g.groups.slice().sort((p, q) => p.start - q.start) : [{ start: 0, count: n * 3, materialIndex: 0 }];
  const index = [];
  const outGroups = [];
  let cur = [];
  let next = [];
  const sideOf = (x) => (x > EPS ? 1 : x < -EPS ? -1 : 0);
  for (const gr of groups) {
    const t0 = Math.floor(gr.start / 3);
    const t1 = Math.min(n, Math.floor((gr.start + gr.count) / 3));
    const start = index.length;
    for (let t = t0; t < t1; t++) {
      cur.length = 0;
      cur.push(triVert(g, t, 0), triVert(g, t, 1), triVert(g, t, 2));
      for (let p = 0; p < np; p++) {
        next.length = 0;
        for (let q = 0; q < cur.length; q += 3) {
          const i0 = cur[q];
          const i1 = cur[q + 1];
          const i2 = cur[q + 2];
          const d0 = dist(i0, p);
          const d1 = dist(i1, p);
          const d2 = dist(i2, p);
          const s0 = sideOf(d0);
          const s1 = sideOf(d1);
          const s2 = sideOf(d2);
          if (!((s0 > 0 || s1 > 0 || s2 > 0) && (s0 < 0 || s1 < 0 || s2 < 0))) {
            next.push(i0, i1, i2);
            continue;
          }
          // Rotate so A is the vertex alone on its side.
          let A = i0;
          let B = i1;
          let C = i2;
          let dA = d0;
          let dB = d1;
          let dC = d2;
          let sB = s1;
          let sC = s2;
          if (s1 !== 0 && s0 !== s1 && s2 !== s1) {
            A = i1; B = i2; C = i0; dA = d1; dB = d2; dC = d0; sB = s2; sC = s0;
          } else if (s2 !== 0 && s0 !== s2 && s1 !== s2) {
            A = i2; B = i0; C = i1; dA = d2; dB = d0; dC = d1; sB = s0; sC = s1;
          }
          if (sB === 0) {
            const Q = split(A, C, dA / (dA - dC), p);
            next.push(A, B, Q, B, C, Q);
          } else if (sC === 0) {
            const Q = split(A, B, dA / (dA - dB), p);
            next.push(A, Q, C, Q, B, C);
          } else {
            const Q1 = split(A, B, dA / (dA - dB), p);
            const Q2 = split(A, C, dA / (dA - dC), p);
            next.push(A, Q1, Q2, Q1, B, C, Q1, C, Q2);
          }
        }
        const tmp = cur;
        cur = next;
        next = tmp;
      }
      for (let q = 0; q < cur.length; q++) index.push(cur[q]);
    }
    if (index.length > start) outGroups.push({ start, count: index.length - start, materialIndex: gr.materialIndex || 0 });
  }
  const geo = new THREE.BufferGeometry();
  views.forEach((v, a) => {
    const arr = new v.raw.constructor(count * v.size);
    for (let i = 0; i < V; i++) for (let k = 0; k < v.size; k++) arr[i * v.size + k] = v.raw[i * v.stride + v.offset + k];
    const integer = !(arr instanceof Float32Array || arr instanceof Float64Array);
    const ex = extra[a];
    for (let k = 0; k < ex.length; k++) arr[V * v.size + k] = integer ? Math.round(ex[k]) : ex[k];
    geo.setAttribute(v.name, new THREE.BufferAttribute(arr, v.size, v.normalized));
  });
  geo.setIndex(new THREE.BufferAttribute(count > 65535 ? new Uint32Array(index) : new Uint16Array(index), 1));
  for (const gr of outGroups) geo.addGroup(gr.start, gr.count, gr.materialIndex);
  geo.userData.breakupCut = true;
  return geo;
}

/* ------------------------------------------------------------------ *
 * Classify every triangle
 * ------------------------------------------------------------------ */

/**
 * Every triangle into a zone. Returns the record the rest of this file works
 * on: per entry its geometry (cut along the boundaries where it crossed one)
 * and a Uint8Array of zone indices (one per triangle, or per instance), every
 * zone's box and triangle count.
 *
 * opts.cut  false skips the cutting (the zone boxes come out the same; only
 *           breaking needs clean edges)
 */
export function classifyModel(survey, layout, opts = {}) {
  const zones = layout.zones;
  const index = new Map(zones.map((z, i) => [z, i]));
  const planes = opts.cut === false ? [] : cutPlanes(layout);
  const boxes = {};
  const counts = {};
  const grow = (id, x, y, z) => {
    let b = boxes[id];
    if (!b) b = boxes[id] = { min: [x, y, z], max: [x, y, z] };
    else {
      if (x < b.min[0]) b.min[0] = x;
      if (y < b.min[1]) b.min[1] = y;
      if (z < b.min[2]) b.min[2] = z;
      if (x > b.max[0]) b.max[0] = x;
      if (y > b.max[1]) b.max[1] = y;
      if (z > b.max[2]) b.max[2] = z;
    }
  };
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const items = [];
  for (const e of survey.entries) {
    if (e.kind === 'sprite') {
      _w.setFromMatrixPosition(e.M);
      const id = layout.classify(_w.x, _w.y, _w.z, null);
      items.push({ e, geo: null, zone: Uint8Array.of(index.get(id)) });
      continue;
    }
    if (e.kind === 'instanced') {
      const g = e.geometry;
      if (!g.boundingBox) g.computeBoundingBox();
      const centre = g.boundingBox.getCenter(new THREE.Vector3());
      const zone = new Uint8Array(e.obj.count);
      for (let k = 0; k < e.obj.count; k++) {
        _m.multiplyMatrices(e.M, instMatrix(e.obj, k));
        _w.copy(centre).applyMatrix4(_m);
        const id = layout.classify(_w.x, _w.y, _w.z, e.hint);
        zone[k] = index.get(id);
        if (!e.effect) {
          grow(id, _w.x, _w.y, _w.z);
          counts[id] = (counts[id] || 0) + 1;
        }
      }
      items.push({ e, geo: null, zone });
      continue;
    }
    const g = (!e.effect && planes.length && cutGeometry(e.geometry, e.M, planes)) || e.geometry;
    const pos = g.attributes.position;
    const n = triCount(g);
    const zone = new Uint8Array(n);
    const M = e.M;
    for (let t = 0; t < n; t++) {
      a.fromBufferAttribute(pos, triVert(g, t, 0)).applyMatrix4(M);
      b.fromBufferAttribute(pos, triVert(g, t, 1)).applyMatrix4(M);
      c.fromBufferAttribute(pos, triVert(g, t, 2)).applyMatrix4(M);
      const id = layout.classify((a.x + b.x + c.x) / 3, (a.y + b.y + c.y) / 3, (a.z + b.z + c.z) / 3, e.hint);
      zone[t] = index.get(id);
      if (!e.effect) {
        grow(id, a.x, a.y, a.z);
        grow(id, b.x, b.y, b.z);
        grow(id, c.x, c.y, c.z);
        counts[id] = (counts[id] || 0) + 1;
      }
    }
    items.push({ e, geo: g, zone });
  }
  return { survey, layout, zones, index, items, boxes, counts };
}

/* ------------------------------------------------------------------ *
 * Geometry subsets
 * ------------------------------------------------------------------ */

const EMPTY = new THREE.BufferGeometry();
EMPTY.setAttribute('position', new THREE.BufferAttribute(new Float32Array(0), 3));
EMPTY.userData.breakupEmpty = true;

/**
 * A new geometry holding only the triangles `keep(t)` says yes to, with its
 * own copies of every attribute (compacted to the vertices it uses) and the
 * material groups kept. `bake` transforms positions and normals by a matrix
 * on the way (for a piece that leaves its mesh behind) — and turns the
 * triangles round if the matrix mirrors, as a wing drawn with scale.x = -1
 * does, or they would all face inwards.
 */
export function subsetGeometry(g, keep, bake = null) {
  const n = triCount(g);
  const groups = g.groups && g.groups.length ? g.groups.slice().sort((p, q) => p.start - q.start) : [{ start: 0, count: n * 3, materialIndex: 0 }];
  const tris = [];
  const outGroups = [];
  for (const gr of groups) {
    const t0 = Math.floor(gr.start / 3);
    const t1 = Math.min(n, Math.floor((gr.start + gr.count) / 3));
    const start = tris.length;
    for (let t = t0; t < t1; t++) if (keep(t)) tris.push(t);
    if (tris.length > start) outGroups.push({ start: start * 3, count: (tris.length - start) * 3, materialIndex: gr.materialIndex || 0 });
  }
  if (!tris.length) return null;
  const flip = !!(bake && bake.determinant() < 0);
  const remap = new Map();
  const verts = [];
  const idx = new Uint32Array(tris.length * 3);
  for (let i = 0; i < tris.length; i++) {
    for (let k = 0; k < 3; k++) {
      const v = triVert(g, tris[i], k);
      let m = remap.get(v);
      if (m === undefined) {
        m = verts.length;
        remap.set(v, m);
        verts.push(v);
      }
      idx[i * 3 + (flip && k ? 3 - k : k)] = m;
    }
  }
  const out = new THREE.BufferGeometry();
  for (const name in g.attributes) {
    const src = g.attributes[name];
    const { raw, stride, offset, size } = rawOf(src);
    const arr = new raw.constructor(verts.length * size);
    for (let i = 0; i < verts.length; i++) {
      const base = verts[i] * stride + offset;
      for (let k = 0; k < size; k++) arr[i * size + k] = raw[base + k];
    }
    const attr = new THREE.BufferAttribute(arr, size, src.normalized);
    if (bake && name === 'position') attr.applyMatrix4(bake);
    if (bake && name === 'normal' && !src.normalized && arr instanceof Float32Array) {
      attr.applyNormalMatrix(new THREE.Matrix3().getNormalMatrix(bake));
    }
    out.setAttribute(name, attr);
  }
  out.setIndex(new THREE.BufferAttribute(verts.length > 65535 ? idx : new Uint16Array(idx), 1));
  for (const gr of outGroups) out.addGroup(gr.start, gr.count, gr.materialIndex);
  out.computeBoundingBox();
  out.computeBoundingSphere();
  // Which source triangle each new one is, in order: so a zone list can follow it.
  out.userData.keptTris = tris;
  return out;
}

/* ------------------------------------------------------------------ *
 * Breaking
 * ------------------------------------------------------------------ */

/** The model's record of what has been taken off it and how to put it back. */
export function recordFor(model) {
  let rec = model.userData.breakup;
  if (!rec) {
    rec = model.userData.breakup = {
      model,
      removed: new Set(),
      originals: new Map(), // mesh -> the geometry it was built with
      owned: new Set(), // geometries made here, safe to dispose
      instanceSaved: new Map(), // instanced mesh -> its matrices as built
      sprites: [], // lamps taken off with a piece: { sprite, parent }
      deformed: new Set(), // zones bent, crushed or folded
    };
  }
  return rec;
}

export function isBroken(model) {
  const rec = model && model.userData && model.userData.breakup;
  return !!(rec && (rec.removed.size || rec.originals.size || rec.deformed.size));
}

/** Swap a mesh's geometry for one made here, remembering the one it was built with. */
function setGeometry(rec, o, geo) {
  if (!rec.originals.has(o)) rec.originals.set(o, o.geometry);
  const prev = o.geometry;
  o.geometry = geo || EMPTY;
  if (geo && geo !== EMPTY) rec.owned.add(geo);
  if (prev !== rec.originals.get(o) && rec.owned.has(prev)) {
    rec.owned.delete(prev);
    prev.dispose();
  }
}

/**
 * Take the zones in `pieces` ([[zone, ...], ...]) off the model. Returns one
 * entry per piece:
 *   { group, zones, com: Vector3 (body metres), size: Vector3, tris, engine, fuel, rotorBlade }
 * `group` holds the piece's meshes in metres around its own centre; the
 * caller places it in the world (model pose x centre) and owns it from then.
 * `opts.rotorBlades` splits a main rotor into that many blades.
 */
export function breakZones(asg, pieces, opts = {}) {
  const rec = recordFor(asg.survey.model);
  const out = [];
  const zoneIdx = (z) => asg.index.get(z);
  const gone = new Set();
  for (const piece of pieces) for (const z of piece) if (asg.index.has(z)) gone.add(zoneIdx(z));
  const rotor = asg.layout.frame.rotor;
  for (const piece of pieces) {
    const set = new Set(piece.filter((z) => asg.index.has(z)).map(zoneIdx));
    if (!set.size) continue;
    const isRotor = piece.length === 1 && piece[0] === 'rotor' && rotor;
    const blades = isRotor ? Math.max(2, opts.rotorBlades || 4) : 1;
    for (let blade = 0; blade < blades; blade++) {
      const group = new THREE.Group();
      group.name = `breakup:${piece.join('+')}${isRotor ? `:${blade}` : ''}`;
      let tris = 0;
      for (const it of asg.items) {
        const e = it.e;
        if (e.effect || e.kind === 'sprite') continue;
        if (e.kind === 'instanced') {
          if (isRotor) continue;
          const ks = [];
          for (let k = 0; k < e.obj.count; k++) if (set.has(it.zone[k])) ks.push(k);
          if (!ks.length) continue;
          const im = new THREE.InstancedMesh(e.geometry, e.obj.material, ks.length);
          ks.forEach((k, i) => im.setMatrixAt(i, _m.multiplyMatrices(e.M, instMatrix(e.obj, k))));
          im.instanceMatrix.needsUpdate = true;
          im.userData.sharedGeometry = true;
          im.castShadow = e.obj.castShadow;
          im.frustumCulled = false;
          group.add(im);
          continue;
        }
        if (!e.obj.visible && !isVisibleLater(e.obj)) continue;
        const g = it.geo;
        const pos = g.attributes.position;
        const keep = (t) => {
          if (!set.has(it.zone[t])) return false;
          if (!isRotor) return true;
          // Which blade: the sector of the disc this triangle's centroid is in.
          _w.set(0, 0, 0);
          for (let k = 0; k < 3; k++) _w.add(_v.fromBufferAttribute(pos, triVert(g, t, k)));
          _w.multiplyScalar(1 / 3).applyMatrix4(e.M);
          const ang = Math.atan2(_w.z - rotor.z, _w.x - rotor.x) + Math.PI;
          return Math.floor((ang / (Math.PI * 2)) * blades) % blades === blade;
        };
        const sub = subsetGeometry(g, keep, e.M);
        if (!sub) continue;
        tris += triCount(sub);
        const mesh = new THREE.Mesh(sub, e.obj.material);
        mesh.name = e.obj.name || 'piece';
        mesh.castShadow = e.obj.castShadow;
        mesh.receiveShadow = e.obj.receiveShadow;
        group.add(mesh);
      }
      if (!group.children.length) continue;
      // Centre the piece on itself.
      const box = new THREE.Box3().setFromObject(group);
      const com = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3());
      const shift = new THREE.Matrix4().makeTranslation(-com.x, -com.y, -com.z);
      for (const ch of group.children) {
        if (ch.isInstancedMesh) {
          for (let i = 0; i < ch.count; i++) {
            ch.getMatrixAt(i, _m);
            ch.setMatrixAt(i, _m.premultiply(shift));
          }
          ch.instanceMatrix.needsUpdate = true;
          // Its bounds were worked out (and kept) before the shift.
          ch.computeBoundingBox();
          ch.computeBoundingSphere();
        } else ch.geometry.translate(-com.x, -com.y, -com.z);
      }
      out.push({
        group,
        zones: piece.slice(),
        com,
        size,
        tris,
        engine: piece.some((z) => ZONES[z] && ZONES[z].engine),
        fuel: piece.some((z) => ZONES[z] && ZONES[z].fuel),
        rotorBlade: !!isRotor,
      });
    }
  }
  for (const piece of pieces) for (const z of piece) rec.removed.add(z);
  removeFromModel(asg, rec, gone);
  return out;
}

/** A gear leg hidden while retracted still has its triangles in the zone. */
function isVisibleLater(obj) {
  for (let n = obj; n; n = n.parent) if (GEAR_NAME.test(n.name || '') || /gear/i.test(n.name || '')) return true;
  return false;
}

/** Hand every affected mesh a geometry without the removed zones' triangles. */
function removeFromModel(asg, rec, gone) {
  for (const it of asg.items) {
    const e = it.e;
    const o = e.obj;
    if (e.kind === 'sprite') {
      if (gone.has(it.zone[0]) && o.parent && !rec.sprites.some((s) => s.sprite === o)) {
        // A lamp on a wing tip that has gone goes with it. Taken out of the
        // model rather than hidden: the model's own update sets .visible and
        // .scale on its lamps every frame, and would put it straight back.
        rec.sprites.push({ sprite: o, parent: o.parent });
        o.parent.remove(o);
      }
      continue;
    }
    if (e.kind === 'instanced') {
      let any = false;
      for (let k = 0; k < o.count; k++) if (gone.has(it.zone[k])) any = true;
      if (!any) continue;
      if (!rec.instanceSaved.has(o)) rec.instanceSaved.set(o, o.instanceMatrix.array.slice());
      const zero = new THREE.Matrix4().makeScale(0, 0, 0);
      for (let k = 0; k < o.count; k++) if (gone.has(it.zone[k])) o.setMatrixAt(k, zero);
      o.instanceMatrix.needsUpdate = true;
      continue;
    }
    let hit = false;
    for (let t = 0; t < it.zone.length; t++) if (gone.has(it.zone[t])) {
      hit = true;
      break;
    }
    if (!hit) continue;
    const rest = subsetGeometry(it.geo, (t) => !gone.has(it.zone[t]));
    const before = it.zone;
    setGeometry(rec, o, rest);
    // What is left is what the zones are read off from now on.
    it.geo = o.geometry;
    it.zone = rest ? Uint8Array.from(rest.userData.keptTris, (t) => before[t]) : new Uint8Array(0);
  }
}

/* ------------------------------------------------------------------ *
 * Bending, crushing, folding
 * ------------------------------------------------------------------ */

/**
 * actions: planBreak()'s, those that are not 'detach'. `hit` is the plan's
 * contact (body metres), used for which way a bend goes. Returns how many
 * vertices moved.
 */
export function deformZones(asg, actions, hit = {}) {
  const rec = recordFor(asg.survey.model);
  let moved = 0;
  for (const a of actions) {
    if (a.action === 'detach' || a.action === 'shake' || a.hidden) continue;
    if (rec.removed.has(a.zone) || !asg.index.has(a.zone)) continue;
    const d = { zone: a.zone, action: a.action, amount: a.amount, point: hit.point || [0, 0, 0], normal: hit.normal || [0, 1, 0], seed: rec.deformed.size + 1 };
    const fn = deformer(asg.layout.frame, d);
    if (!fn) continue;
    rec.deformed.add(a.zone);
    moved += applyDeform(asg, rec, d, fn);
  }
  return moved;
}

function applyDeform(asg, rec, d, fn) {
  const L = asg.layout;
  const idx = asg.index.get(d.zone);
  const inv = new THREE.Matrix4();
  let moved = 0;
  for (const it of asg.items) {
    const e = it.e;
    if (e.kind !== 'mesh' || e.effect) continue;
    if (!it.zone.includes(idx)) continue;
    const o = e.obj;
    // Deformed on a geometry of its own (the cut one), never the shared one.
    if (!rec.owned.has(o.geometry)) {
      let mine = it.geo;
      let zones = it.zone;
      if (!(it.geo !== e.geometry && it.geo.userData.breakupCut)) {
        mine = subsetGeometry(it.geo, () => true);
        zones = Uint8Array.from(mine.userData.keptTris, (t) => it.zone[t]);
      }
      setGeometry(rec, o, mine);
      it.geo = o.geometry;
      it.zone = zones;
    }
    const g = o.geometry;
    if (g === EMPTY) continue;
    const pos = g.attributes.position;
    inv.copy(e.M).invert();
    // Vertices that belong to a triangle of this zone.
    const mark = new Uint8Array(pos.count);
    for (let t = 0; t < it.zone.length; t++) {
      if (it.zone[t] !== idx) continue;
      for (let k = 0; k < 3; k++) mark[triVert(g, t, k)] = 1;
    }
    for (let i = 0; i < pos.count; i++) {
      if (!mark[i]) continue;
      _w.fromBufferAttribute(pos, i).applyMatrix4(e.M);
      if (fn(_w)) {
        _w.applyMatrix4(inv);
        pos.setXYZ(i, _w.x, _w.y, _w.z);
        moved++;
      }
    }
    pos.needsUpdate = true;
    if (g.attributes.normal) g.computeVertexNormals();
    g.computeBoundingBox();
    g.computeBoundingSphere();
  }
  void L;
  return moved;
}

/** One deformation, in body metres: a function that moves a point (true if it did). */
function deformer(f, d) {
  const sc = f.scale || 1;
  const k = Math.max(0, Math.min(1, d.amount));
  const zone = d.zone;
  const Z = ZONES[zone] || {};
  const q = new THREE.Quaternion();
  const rot = (axis, origin, ang) => {
    const qq = new THREE.Quaternion().setFromAxisAngle(axis, ang);
    const oo = origin.clone();
    return (p) => {
      p.sub(oo).applyQuaternion(qq).add(oo);
      return true;
    };
  };
  void q;
  const up = d.normal[1] >= 0 ? 1 : -1;
  if (Z.kind === 'wing' && f.wing) {
    const s = Z.side;
    const outer = /Outer/.test(zone);
    const hingeX = outer ? f.wing.splitX : Math.max(f.wing.rootX, 0.05);
    // Bent up and back, the way a tip that has hit the ground goes.
    const r1 = rot(new THREE.Vector3(0, 0, 1), new THREE.Vector3(s * hingeX, f.wing.y, 0), s * k * (outer ? 0.5 : 0.22) * up);
    const r2 = rot(new THREE.Vector3(0, 1, 0), new THREE.Vector3(s * hingeX, 0, f.wing.rootLE), -s * k * 0.12);
    return (p) => {
      if (Math.abs(p.x) < hingeX) return false;
      r1(p);
      r2(p);
      return true;
    };
  }
  if (zone === 'fin') {
    const top = bodyAt(f, f.tailZ - 0.1 * f.L).top;
    const side = d.point[0] >= 0 ? -1 : 1;
    const r = rot(new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, top, 0), side * k * 0.45);
    return (p) => (p.y > top ? r(p) : false);
  }
  if (zone === 'tailplaneL' || zone === 'tailplaneR') {
    const s = Z.side;
    const root = 0.3 * sc;
    const r = rot(new THREE.Vector3(0, 0, 1), new THREE.Vector3(s * root, 0, 0), s * k * 0.4 * up);
    return (p) => (Math.abs(p.x) > root ? r(p) : false);
  }
  if (Z.kind === 'engine') {
    const e = f.engines.find((q2) => q2.id === zone);
    if (!e) return null;
    if (e.prop || e.nose) {
      // Bent propeller: the blade tips curl back.
      const R = Math.max(0.3, e.propR || 1);
      return (p) => {
        const r = Math.hypot(p.x - e.x, p.y - e.y);
        if (r < R * 0.25) return false;
        const t = Math.min(1.2, r / R) ** 2;
        p.z += t * k * 0.35 * R;
        p.x -= (p.x - e.x) * 0.08 * t * k;
        return true;
      };
    }
    // A nacelle knocked askew on its pylon.
    return rot(new THREE.Vector3(1, 0, 0), new THREE.Vector3(e.x, e.y + e.r, e.z), k * 0.18 * up);
  }
  if (Z.kind === 'gear') {
    const g = f.gear.find((q2) => q2.id === zone);
    if (!g) return null;
    // Folded back and up under the belly.
    return rot(new THREE.Vector3(1, 0, 0), new THREE.Vector3(g.x, f.gearTopY, g.z), k * 1.35);
  }
  if (zone === 'rotor' || zone === 'tailRotor') {
    const R = f.rotor ? f.rotor.r : 4;
    const c = f.rotor || { x: 0, y: 0, z: 0 };
    return (p) => {
      const r = Math.hypot(p.x - c.x, p.z - c.z);
      p.y -= (r / R) ** 2 * k * 0.3 * R;
      return true;
    };
  }
  if (zone === 'nose') {
    const zs = f.noseSplit;
    // Concertinaed back towards the cockpit, and pushed down a little.
    return (p) => {
      const dz = zs - p.z;
      if (dz <= 0) return false;
      p.z = zs - dz * (1 - 0.38 * k);
      p.y -= dz * 0.12 * k * up;
      p.x += Math.sin(p.z * 7.1 + d.seed) * 0.0025 * k * f.L;
      return true;
    };
  }
  if (zone === 'rear') {
    const r = rot(new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, f.rearSplit), -k * 0.16 * up);
    return (p) => (p.z > f.rearSplit ? r(p) : false);
  }
  if (zone === CORE) {
    const amp = 0.012 * f.L * k;
    return (p) => {
      p.y += Math.sin(p.z * 3.1 + d.seed) * amp * 0.6;
      p.x += Math.sin(p.z * 2.3 + d.seed * 0.7) * amp * 0.4 * Math.sign(p.x || 1);
      return true;
    };
  }
  return null;
}

/* ------------------------------------------------------------------ *
 * Putting it back
 * ------------------------------------------------------------------ */

/** Everything back exactly as built. Pieces are the caller's to dispose. */
export function restoreModel(model) {
  const rec = model && model.userData && model.userData.breakup;
  if (!rec) return false;
  for (const [mesh, original] of rec.originals) mesh.geometry = original;
  for (const g of rec.owned) g.dispose();
  rec.owned.clear();
  for (const [mesh, arr] of rec.instanceSaved) {
    mesh.instanceMatrix.array.set(arr);
    mesh.instanceMatrix.needsUpdate = true;
  }
  for (const s of rec.sprites) if (s.parent && !s.sprite.parent) s.parent.add(s.sprite);
  model.userData.breakup = null;
  return true;
}

/** Dispose a piece's own geometry (never a shared one) and take it out of the scene. */
export function disposePiece(group) {
  if (!group) return;
  group.removeFromParent();
  group.traverse((o) => {
    if (o.isInstancedMesh) {
      o.dispose();
      return;
    }
    if (o.isMesh && o.geometry && !o.userData.sharedGeometry) o.geometry.dispose();
  });
}

/**
 * The whole of what is drawn, as one piece: every visible mesh baked into
 * metres around its middle, its own geometry. For a wreck that goes into the
 * sea in one piece — an aircraft knocked down whose owner is about to tidy it
 * away, a van that drove off the quay — so it can sink slowly where it went in
 * while the thing it was a copy of is disposed or put back on the road.
 * Returns { group, com, size } (body metres) or null.
 */
export function bakeWhole(model, opts = {}) {
  const survey = surveyModel(model, opts);
  const group = new THREE.Group();
  group.name = 'breakup:wreck';
  const shown = (o) => {
    for (let n = o; n && n !== model; n = n.parent) if (!n.visible) return false;
    return true;
  };
  for (const e of survey.entries) {
    if (e.effect || e.kind === 'sprite' || !shown(e.obj)) continue;
    if (e.kind === 'instanced') {
      const im = new THREE.InstancedMesh(e.geometry, e.obj.material, Math.max(1, e.obj.count));
      for (let k = 0; k < e.obj.count; k++) im.setMatrixAt(k, _m.multiplyMatrices(e.M, instMatrix(e.obj, k)));
      im.count = e.obj.count;
      im.instanceMatrix.needsUpdate = true;
      im.userData.sharedGeometry = true;
      im.frustumCulled = false;
      group.add(im);
      continue;
    }
    const sub = subsetGeometry(e.geometry, () => true, e.M);
    if (!sub) continue;
    const mesh = new THREE.Mesh(sub, e.obj.material);
    mesh.castShadow = e.obj.castShadow;
    group.add(mesh);
  }
  if (!group.children.length) return null;
  const box = new THREE.Box3().setFromObject(group);
  const com = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const shift = new THREE.Matrix4().makeTranslation(-com.x, -com.y, -com.z);
  for (const ch of group.children) {
    if (ch.isInstancedMesh) {
      for (let i = 0; i < ch.count; i++) {
        ch.getMatrixAt(i, _m);
        ch.setMatrixAt(i, _m.premultiply(shift));
      }
      ch.instanceMatrix.needsUpdate = true;
      ch.computeBoundingBox();
      ch.computeBoundingSphere();
    } else ch.geometry.translate(-com.x, -com.y, -com.z);
  }
  return { group, com, size };
}

/** Triangles each zone has now, for the tests and the console. */
export function zoneTriangles(asg) {
  return { ...asg.counts };
}

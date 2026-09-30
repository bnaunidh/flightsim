/**
 * Walking about: the ground under your feet, what you cannot walk through,
 * and the water you cannot walk into.
 *
 * Pure logic and no DOM, so tests/features/onfoot.mjs can drive a walker in
 * node against boxes it made up.
 *
 * THE GROUND. heightAt() is the ground as defined; the terrain the player sees
 * is a grid of triangles sampled from it every 39 m (71 m at low detail), and
 * on a hillside the two disagree by a metre or more. Standing on heightAt put
 * the feet inside the drawn slope on every concave bit of hill and floating
 * over every convex one. So the walker stands on the drawn triangle, read
 * straight out of the terrain mesh's own vertex array — the same three numbers
 * the GPU draws — except where something is built on heightAt itself: the
 * airfield's tarmac, a deck, a pad, a quay, a harbour wall. See groundAt.
 *
 * THE FLOOR. What a shoe stands on is sometimes a few centimetres over that
 * ground: the runway is laid 6 cm up, the taxiways and aprons 5, a road's
 * ribbon 6 cm over its bed, a pad's painted disc on its deck. floorAt() is
 * the ground plus that, and it is where the walker's feet go.
 *
 * SOLID THINGS. terrain.js's OBSTACLES are world axis-aligned boxes: the
 * terminal, the tower, hangars, houses, even tree trunks — thousands of them
 * on a wooded map. The walker keeps a short list of the ones within 40 m and
 * only refreshes it when it has moved 12 m, so a frame tests a handful of
 * boxes, not the whole island. Parked aeroplanes and ground vehicles are not
 * in OBSTACLES (they move); they come in as oriented boxes ("solids").
 *
 * WATER. Ankle deep is a paddle at half speed; past WALK.deep the step is
 * refused. You cannot wade out to sea, and you cannot step off a carrier deck
 * into it either, because the deck edge is a forty-metre drop into water that
 * is far too deep.
 */

import * as THREE from '../../vendor/three.module.js';
import { heightAt, OBSTACLES, isPaved, platformAt, flatAt, MAP } from '../../world/terrain.js';

export const WALK = {
  /** m/s. A brisk walk and a proper run — a ten-year-old's run, fast. */
  walk: 1.8,
  run: 5.2,
  /** Fraction of speed kept while paddling in shallow water. */
  wade: 0.55,
  /** Sea bed deeper than this (metres below sea level) is too deep to walk into. */
  deep: -0.55,
  radius: 0.32,
  height: 1.75,
  jump: 4.4,
  gravity: 14,
  /** Steepest climb, metres up per metre along. 1.4 is 54 degrees. */
  maxRise: 1.4,
  /** How quickly the legs get up to speed, 1/s. */
  accel: 11,
  /** Longest single move before it is split, metres. Less than the radius. */
  maxStep: 0.24,
};

/* ------------------------------------------------------------------ */
/* The ground as drawn                                                 */
/* ------------------------------------------------------------------ */

const CHUNKS = [];

/**
 * Read the terrain group's chunk meshes once per world build. Each chunk is a
 * PlaneGeometry grid laid flat; its row and column spacing and origin are read
 * from the first vertices rather than assumed, so a change to how the grid is
 * rotated cannot silently put every foot in the wrong triangle.
 */
export function setTerrainMeshes(group) {
  CHUNKS.length = 0;
  if (!group || !group.children) return 0;
  for (const m of group.children) {
    const geo = m && m.isMesh && m.geometry;
    const attr = geo && geo.attributes && geo.attributes.position;
    if (!attr || attr.itemSize !== 3) continue;
    if (m.rotation.x || m.rotation.y || m.rotation.z) continue;
    if (m.scale.x !== 1 || m.scale.y !== 1 || m.scale.z !== 1) continue;
    const n = attr.count;
    const W = Math.round(Math.sqrt(n));
    if (W < 2 || W * W !== n) continue;
    const a = attr.array;
    const x0 = a[0] + m.position.x;
    const z0 = a[2] + m.position.z;
    const dx = a[3] - a[0];
    const dz = a[W * 3 + 2] - a[2];
    if (!(Math.abs(dx) > 1e-6) || !(Math.abs(dz) > 1e-6)) continue;
    // A grid whose second row is not straight below the first is not a grid.
    if (Math.abs(a[W * 3] - a[0]) > 1e-3 || Math.abs(a[5] - a[2]) > 1e-3) continue;
    const x1 = x0 + dx * (W - 1);
    const z1 = z0 + dz * (W - 1);
    CHUNKS.push({
      a, W, x0, z0, dx, dz, y: m.position.y,
      xa: Math.min(x0, x1), xb: Math.max(x0, x1),
      za: Math.min(z0, z1), zb: Math.max(z0, z1),
      spacing: Math.abs(dx),
    });
  }
  // Finest first: where a detail chunk overlaps the big one, it is the one
  // on top and the one to stand on.
  CHUNKS.sort((p, q) => p.spacing - q.spacing);
  return CHUNKS.length;
}

/** Height of the drawn terrain triangle at (x, z), or null off every chunk. */
export function drawnHeight(x, z) {
  for (let i = 0; i < CHUNKS.length; i++) {
    const c = CHUNKS[i];
    if (x < c.xa || x > c.xb || z < c.za || z > c.zb) continue;
    const fx = (x - c.x0) / c.dx;
    const fz = (z - c.z0) / c.dz;
    let ix = Math.floor(fx);
    let iz = Math.floor(fz);
    if (ix > c.W - 2) ix = c.W - 2;
    if (iz > c.W - 2) iz = c.W - 2;
    if (ix < 0) ix = 0;
    if (iz < 0) iz = 0;
    const u = fx - ix;
    const v = fz - iz;
    const A = c.a;
    // PlaneGeometry's two triangles per cell: (a, b, d) and (b, c, d), split
    // on the b–d diagonal where u + v = 1.
    const ia = (iz * c.W + ix) * 3 + 1;
    const ib = ((iz + 1) * c.W + ix) * 3 + 1;
    const ic = ((iz + 1) * c.W + ix + 1) * 3 + 1;
    const id = (iz * c.W + ix + 1) * 3 + 1;
    if (u + v <= 1) return c.y + A[ia] + (A[id] - A[ia]) * u + (A[ib] - A[ia]) * v;
    return c.y + A[ic] + (A[ib] - A[ic]) * (1 - u) + (A[id] - A[ic]) * (1 - v);
  }
  return null;
}

/*
 * What is drawn over the ground, handed in by onfoot.js once per world (and
 * again if the road ribbon is re-laid): roads.js's drawn-ground sampler, the
 * same one the van rides, its ribbon on its own, and the pads.
 */
const DRAWN = { ground: null, ribbon: null, lift: 0, pads: [] };

/**
 * The world's drawn surfaces for groundAt and floorAt.
 *   ground(x, z)  the van's ground as drawn (roads.js drawnGroundSampler), or null
 *   ribbon(x, z)  the road's tarmac, less its lift (roads.js ribbonSampler), or null
 *   lift          how far the ribbon is drawn over that
 *   pads          [{ x, z, r, y, top }]: a pad's platform height and its disc's
 */
export function setDrawn({ ground = null, ribbon = null, lift = 0, pads = [] } = {}) {
  DRAWN.ground = typeof ground === 'function' ? ground : null;
  DRAWN.ribbon = typeof ribbon === 'function' ? ribbon : null;
  DRAWN.lift = lift || 0;
  DRAWN.pads = Array.isArray(pads) ? pads : [];
}

/** The runway is laid 6 cm over heightAt, the taxiways and aprons 5 (airport.js). */
export const PAVE_LIFT = 0.055;

/*
 * On the harbour's quay deck: the one authored flat that has a deck built on
 * it (scenery.js addHarbour, same test). The other flats — a depot, a town
 * square — are drawn by the terrain mesh like any other ground, and standing
 * on heightAt there left the walker 80 cm up in the air along the edge of
 * Drover's Flat depot.
 */
function onQuayDeck(x, z) {
  const hc = MAP && MAP.scenery && MAP.scenery.harbour;
  if (!hc) return false;
  const dressed = !!(hc.breakwater || hc.moorings || hc.fishingFleet || hc.fuelJetty);
  if (!hc.flat && dressed) return false;
  const f = flatAt(x, z);
  return !!f && f.id === (hc.flat || 'quay') && x >= f.x0 && x <= f.x1 && z >= f.z0 && z <= f.z1;
}

/** Near a harbour: its walls and breakwaters are geometry laid on heightAt. */
function nearHarbour(x, z) {
  const H = MAP && MAP.waters && MAP.waters.harbour;
  if (!H || H._pending || !(H._reach > 0)) return false;
  return Math.abs(x - H.cx) < H._reach && Math.abs(z - H.cz) < H._reach;
}

/** The pad whose disc is under (x, z) at about height h, or null. */
function padAt(x, z, h) {
  const list = DRAWN.pads;
  for (let i = 0; i < list.length; i++) {
    const p = list[i];
    const dx = x - p.x;
    const dz = z - p.z;
    if (dx * dx + dz * dz < p.r * p.r && Math.abs(h - p.y) < 0.6) return p;
  }
  return null;
}

/**
 * The ground at (x, z). See the note at the top.
 *
 * It used to be heightAt wherever heightAt was flat, on the grounds that flat
 * is built ground. But heightAt is flat along every road corridor cut into a
 * hillside, and the grid draws that cut as a smooth slope: measured on
 * Kestrel at (-1170, -104), heightAt 21.3 and the grass drawn at 23.2 — the
 * walker was two metres under the hill — and twenty metres on, where the cut
 * bank is steeper than the grid, heightAt won for being 1.2 m over it and
 * the walker stood three metres up in the air. Now the drawn ground is the
 * rule, and heightAt only where something is really built on it.
 */
export function groundAt(x, z) {
  return ground(x, z);
}

/** What ground() last stood on: 0 terrain / built on heightAt, 1 tarmac, 2 road, 3 pad. */
let KIND = 0;
let PAD = null;

function ground(x, z) {
  KIND = 0;
  PAD = null;
  const h = heightAt(x, z);
  if (!CHUNKS.length) return h;
  // Decks, pads and the harbour's quay are built on heightAt.
  const pad = padAt(x, z, h);
  if (pad) {
    KIND = 3;
    PAD = pad;
    return h;
  }
  if (platformAt(x, z) || onQuayDeck(x, z)) return h;
  const m = drawnHeight(x, z);
  /*
   * The airfield's tarmac is laid on heightAt where the airfield flattened
   * it, which is where the mesh draws it flat too. Where the two part, the
   * paved test has run past what is drawn (measured on Sennen: "paved"
   * ground drawn as grass 33 cm under heightAt), and the grass is the floor.
   */
  const harbour = nearHarbour(x, z);
  if (!harbour && isPaved(x, z) && (m === null || Math.abs(h - m) < 0.15)) {
    KIND = 1;
    return h;
  }
  // Roads and the ground round them, as the van rides them.
  if (DRAWN.ground && !harbour) {
    const d = DRAWN.ground(x, z);
    if (d > -Infinity) {
      if (DRAWN.ribbon) {
        const t = DRAWN.ribbon(x, z);
        if (t > -Infinity && Math.abs(t - d) < 0.05) KIND = 2;
      }
      return d;
    }
  }
  if (m === null) return h;
  // A harbour wall the 25 m grid is too coarse to show, and its quays.
  if (harbour && (h > m + 1.2 || flatHere(x, z, h))) return h;
  return m;
}

function flatHere(x, z, h) {
  const e = 1.5;
  return Math.abs(heightAt(x + e, z) - h) + Math.abs(heightAt(x - e, z) - h) + Math.abs(heightAt(x, z + e) - h) + Math.abs(heightAt(x, z - e) - h) < 0.03;
}

/**
 * Where a shoe goes down at (x, z): the ground, plus whatever is laid on it
 * there — tarmac, a road's ribbon, a pad's disc. 5 to 14 cm, and it is the
 * difference between a pilot standing on the apron and one standing in it
 * up to the laces (measured at the Skylark's door: the runway drawn 6 cm
 * over the walker's soles; the pad at the Skyhook's door 14; the road by
 * the van 14.6).
 */
export function floorAt(x, z) {
  const g = ground(x, z);
  if (KIND === 1) return g + PAVE_LIFT;
  if (KIND === 2) return g + DRAWN.lift;
  if (KIND === 3) return PAD.top;
  return g;
}

/* ------------------------------------------------------------------ */
/* Solid things                                                        */
/* ------------------------------------------------------------------ */

const NEAR = [];
/** Props (oriented boxes) near the walker; see PROPS. */
const NEARP = [];
const near = { x: 1e9, z: 1e9, n: -1, gen: -1, pgen: -1 };
let generation = 0;
/** Bumped when a moving prop has moved: the props short list is re-read, not OBSTACLES. */
let propGen = 0;

/** The world was rebuilt: every box in the short list may be a ghost. */
export function forgetObstacles() {
  generation++;
  NEAR.length = 0;
  NEARP.length = 0;
  near.n = -1;
}

/*
 * PROPS: the solid things the airfield draws but never told OBSTACLES about.
 *
 * OBSTACLES is the crash list — the terminal, the tower, the hangars — and
 * an aeroplane only needs to know about things it could fly into. Walking,
 * you meet everything else: the air-bridge columns, the fuel bowser, the
 * airliners parked on the other stands, the cones. Measured on Kestrel's
 * apron before this: the walker went straight through the Meridian parked on
 * stand 1, through a jet bridge's lifting column, and the ramp crew's
 * marshalling spot was INSIDE that column, so the camera behind the
 * marshaller looked out through a grey pillar and a pair of wheels.
 *
 * Each prop is an ORIENTED box, read off the mesh's own bounding box and its
 * transform, and kept only if it is solid at walking height: taller than a
 * kerb, not all of it above a person's head, smaller than a building.
 *
 * INSTANCED MESHES TOO. The airfield the airport team rebuilt draws its
 * parked airliners, jet bridges, service trucks, carts and car park as
 * InstancedMesh — measured on the integration build, 94 of them, against 29
 * plain meshes — and those were skipped: the walker went through every parked
 * airliner, bridge and fuel truck on the apron, and the ramp vehicles drove
 * through them. Every instance is a prop now, and an axis-aligned box would
 * not do for them: a parked Meridian's wing part turned at 45 degrees is a
 * forty-metre square. Instances move (the baggage trains drive round), so an
 * InstancedMesh whose matrices have changed — its instanceMatrix.version,
 * which three.js bumps on every needsUpdate — has its boxes read again.
 *
 * A PARKED AEROPLANE drawn as instances (named "parked:<type>|<livery>") is
 * not boxed part by part: one material's part of a 747 is the whole
 * aeroplane, wings and all, a 65-metre square nobody could walk into. If the
 * caller can measure that type (opts.aircraft), it is a fuselage box and a
 * wing box at the wing's height, as the aeroplane you climbed out of is.
 *
 * A mesh hidden later (the ramp crew moves clutter off its stand) stops being
 * solid at once: shown() is asked every time.
 */
const PROPS = [];
/** InstancedMeshes read into PROPS, with the matrix version they were read at. */
const INSTS = [];
const _m4 = new THREE.Matrix4();
const _m4b = new THREE.Matrix4();
const _bx = new THREE.Box3();

function shown(o) {
  for (let p = o; p; p = p.parent) if (p.visible === false) return false;
  return true;
}

function newProp(obj, what) {
  return {
    x: 0, z: 0, fx: 0, fz: -1, hl: 0, hw: 0, y0: 0, y1: 0,
    x0: 0, x1: 0, z0: 0, z1: 0, on: false, what, obj,
  };
}

/** The prop's world box for quick rejects, from its oriented one. */
function bound(p) {
  const ex = Math.abs(p.fx) * p.hl + Math.abs(p.fz) * p.hw;
  const ez = Math.abs(p.fz) * p.hl + Math.abs(p.fx) * p.hw;
  p.x0 = p.x - ex;
  p.x1 = p.x + ex;
  p.z0 = p.z - ez;
  p.z1 = p.z + ez;
}

/** Solid at walking height, and not a building (OBSTACLES has those)? */
function keep(p) {
  if (!(p.y1 - p.y0 > 0.3) || p.hl > 22.5 || p.hw > 22.5 || (p.hl < 0.06 && p.hw < 0.06)) return false;
  const g = heightAt(p.x, p.z);
  // A kerb you step over, or a canopy you walk under: not in the way.
  return !(p.y1 < g + 0.35 || p.y0 > g + 2.4);
}

/**
 * An oriented box from a local bounding box and a world matrix (elements `e`).
 * Upright things (turned about the vertical only) keep their turn; anything
 * tilted — a belt loader's belt — is boxed square to the world instead.
 */
function boxFrom(p, e, lb) {
  const sx = Math.hypot(e[0], e[1], e[2]);
  const sy = Math.hypot(e[4], e[5], e[6]);
  const sz = Math.hypot(e[8], e[9], e[10]);
  const cx = (lb.min.x + lb.max.x) / 2;
  const cy = (lb.min.y + lb.max.y) / 2;
  const cz = (lb.min.z + lb.max.z) / 2;
  const fl = Math.hypot(e[8], e[10]);
  if (sy > 1e-6 && Math.abs(e[5]) / sy > 0.97 && fl > 1e-6 && sx > 1e-6) {
    p.x = e[0] * cx + e[4] * cy + e[8] * cz + e[12];
    p.z = e[2] * cx + e[6] * cy + e[10] * cz + e[14];
    const y = e[1] * cx + e[5] * cy + e[9] * cz + e[13];
    const hy = ((lb.max.y - lb.min.y) / 2) * sy;
    p.fx = e[8] / fl;
    p.fz = e[10] / fl;
    p.hl = ((lb.max.z - lb.min.z) / 2) * sz;
    p.hw = ((lb.max.x - lb.min.x) / 2) * sx;
    p.y0 = y - hy;
    p.y1 = y + hy;
  } else {
    _m4b.fromArray(e);
    _bx.copy(lb).applyMatrix4(_m4b);
    p.x = (_bx.min.x + _bx.max.x) / 2;
    p.z = (_bx.min.z + _bx.max.z) / 2;
    p.fx = 0;
    p.fz = -1;
    p.hl = (_bx.max.z - _bx.min.z) / 2;
    p.hw = (_bx.max.x - _bx.min.x) / 2;
    p.y0 = _bx.min.y;
    p.y1 = _bx.max.y;
  }
  bound(p);
  p.on = keep(p);
}

/**
 * A parked aeroplane's two boxes, from its root's world matrix and the
 * measured type: `body` along the fuselage, `wing` at the wing's height.
 */
function planeBoxes(body, wing, e, prof) {
  const fl = Math.hypot(e[8], e[10]) || 1;
  // The model faces -Z: its nose points along minus its Z axis.
  const fx = -e[8] / fl;
  const fz = -e[10] / fl;
  const ox = e[12];
  const oz = e[14];
  const g = heightAt(ox, oz);
  const mid = (prof.nose + prof.tail) / 2;
  body.x = ox + fx * mid;
  body.z = oz + fz * mid;
  body.fx = fx;
  body.fz = fz;
  body.hl = (prof.nose - prof.tail) / 2;
  body.hw = prof.halfWidth;
  body.y0 = g - 1;
  body.y1 = g + Math.max(1, prof.top);
  bound(body);
  body.on = true;
  const wm = (prof.wingFront + prof.wingBack) / 2;
  wing.x = ox + fx * wm;
  wing.z = oz + fz * wm;
  wing.fx = fx;
  wing.fz = fz;
  wing.hl = (prof.wingFront - prof.wingBack) / 2;
  wing.hw = prof.wingSpan || prof.halfSpan;
  wing.y0 = g + prof.wingH - 0.3;
  wing.y1 = g + prof.wingH + 0.3;
  bound(wing);
  wing.on = wing.hl > 0 && wing.hw > 0;
}

/** Read (or read again) every instance of one InstancedMesh into its props. */
function readInstances(rec) {
  const o = rec.mesh;
  const n = Math.max(0, o.count | 0);
  const lb = o.geometry.boundingBox;
  while (rec.props.length < n * rec.per) {
    const p = newProp(o, rec.prof ? (rec.props.length % 2 ? 'a wing' : 'an aeroplane') : 'something in the way');
    rec.props.push(p);
    PROPS.push(p);
  }
  for (let i = 0; i < rec.props.length; i++) rec.props[i].on = false;
  for (let i = 0; i < n; i++) {
    o.getMatrixAt(i, _m4);
    _m4.premultiply(o.matrixWorld);
    const e = _m4.elements;
    if (rec.prof) planeBoxes(rec.props[i * 2], rec.props[i * 2 + 1], e, rec.prof);
    else boxFrom(rec.props[i], e, lb);
  }
  rec.version = o.instanceMatrix ? o.instanceMatrix.version : 0;
  rec.count = n;
}

/**
 * Collect props from these groups. Returns how many are solid.
 *
 *   opts.aircraft(typeId) -> the type's measured profile (jobs.js
 *   planeProfile), or null: how parked aeroplanes drawn as instances are
 *   boxed. Without it they are boxed part by part like anything else.
 */
export function setProps(groups, opts = {}) {
  PROPS.length = 0;
  INSTS.length = 0;
  forgetObstacles();
  const measure = opts && typeof opts.aircraft === 'function' ? opts.aircraft : null;
  const planes = new Set();
  for (const grp of groups || []) {
    if (!grp || !grp.traverse) continue;
    try {
      grp.updateMatrixWorld(true);
    } catch (e) {
      continue;
    }
    grp.traverse((o) => {
      if (!o.isMesh || o.isSkinnedMesh || !o.geometry) return;
      const geo = o.geometry;
      if (!geo.boundingBox) geo.computeBoundingBox();
      if (!geo.boundingBox || geo.boundingBox.isEmpty()) return;
      if (o.isInstancedMesh) {
        let prof = null;
        const m = /^parked:([^|]+)/.exec(o.name || '');
        if (m && measure) {
          // Every material's part of the same aeroplanes shares their
          // matrices: the first part stands for all of them.
          if (planes.has(o.name)) return;
          try {
            prof = measure(m[1]) || null;
          } catch (e) {
            prof = null;
          }
          if (prof) planes.add(o.name);
        }
        const rec = { mesh: o, props: [], per: prof ? 2 : 1, prof, version: -1, count: 0 };
        INSTS.push(rec);
        readInstances(rec);
        return;
      }
      const p = newProp(o, 'something in the way');
      boxFrom(p, o.matrixWorld.elements, geo.boundingBox);
      if (p.on) PROPS.push(p);
    });
  }
  return propCount();
}

/** Solid props, for the tests. */
export function propCount() {
  let n = 0;
  for (let i = 0; i < PROPS.length; i++) if (PROPS[i].on) n++;
  return n;
}

/**
 * Read again the instances that have moved since they were last read. Once
 * a frame, from the walker and the ramp vehicles; comparing a version number
 * per InstancedMesh is all it costs when nothing has moved.
 */
export function tickProps() {
  let moved = false;
  for (let i = 0; i < INSTS.length; i++) {
    const rec = INSTS[i];
    const o = rec.mesh;
    const v = o.instanceMatrix ? o.instanceMatrix.version : 0;
    if (v === rec.version && (o.count | 0) === rec.count) continue;
    readInstances(rec);
    moved = true;
  }
  if (moved) propGen++;
  return moved;
}

/** Is a circle of radius r at (x, z) inside an oriented box? */
function inOriented(s, x, z, r) {
  const px = x - s.x;
  const pz = z - s.z;
  const a = px * s.fx + pz * s.fz;
  const b = px * -s.fz + pz * s.fx;
  return Math.abs(a) < s.hl + r && Math.abs(b) < s.hw + r;
}

/**
 * The first prop overlapping an upright box, or null. For a vehicle's nose
 * and tail; the bounding test comes first so most props cost four compares.
 */
export function propAt(x, z, y0, y1, r = 0) {
  for (let i = 0; i < PROPS.length; i++) {
    const o = PROPS[i];
    if (!o.on) continue;
    if (x + r <= o.x0 || x - r >= o.x1 || z + r <= o.z0 || z - r >= o.z1) continue;
    if (y1 <= o.y0 || y0 >= o.y1) continue;
    if (!inOriented(o, x, z, r)) continue;
    if (!shown(o.obj)) continue;
    return o;
  }
  return null;
}

function refreshNear(x, z) {
  const R = 40;
  const moved = !(Math.abs(x - near.x) < 12 && Math.abs(z - near.z) < 12);
  if (moved || near.gen !== generation || near.n !== OBSTACLES.length) {
    NEAR.length = 0;
    near.x = x;
    near.z = z;
    near.n = OBSTACLES.length;
    near.gen = generation;
    near.pgen = -1;
    for (let i = 0; i < OBSTACLES.length; i++) {
      const o = OBSTACLES[i];
      if (o.x1 > near.x - R && o.x0 < near.x + R && o.z1 > near.z - R && o.z0 < near.z + R) NEAR.push(o);
    }
  }
  if (near.pgen !== propGen) {
    near.pgen = propGen;
    NEARP.length = 0;
    for (let i = 0; i < PROPS.length; i++) {
      const o = PROPS[i];
      if (o.on && o.x1 > near.x - R && o.x0 < near.x + R && o.z1 > near.z - R && o.z0 < near.z + R) NEARP.push(o);
    }
  }
}

/** How many boxes the walker is currently testing. For the tests. */
export function nearCount() {
  return NEAR.length + NEARP.length;
}

const _p = { x: 0, z: 0 };

/**
 * Push a circle out of one world axis-aligned box. Writes the answer into
 * `_p`; returns true if it moved.
 */
function outOfBox(x, z, r, x0, x1, z0, z1) {
  const cx = x < x0 ? x0 : x > x1 ? x1 : x;
  const cz = z < z0 ? z0 : z > z1 ? z1 : z;
  const dx = x - cx;
  const dz = z - cz;
  const d2 = dx * dx + dz * dz;
  if (d2 >= r * r) return false;
  if (d2 > 1e-12) {
    const d = Math.sqrt(d2);
    _p.x = cx + (dx / d) * r;
    _p.z = cz + (dz / d) * r;
    return true;
  }
  // The centre is inside: out through the nearest face.
  const l = x - x0;
  const rr = x1 - x;
  const b = z - z0;
  const t = z1 - z;
  const m = Math.min(l, rr, b, t);
  _p.x = x;
  _p.z = z;
  if (m === l) _p.x = x0 - r;
  else if (m === rr) _p.x = x1 + r;
  else if (m === b) _p.z = z0 - r;
  else _p.z = z1 + r;
  return true;
}

/**
 * An oriented box, for things that are not in OBSTACLES because they move or
 * turn: a parked aeroplane's fuselage, a tug, a baggage cart.
 *
 *   { x, z, heading (deg), hl (half length, along the nose), hw (half width),
 *     y0, y1 }  — all world metres.
 */
export function solidBox(out, x, z, headingDeg, hl, hw, y0, y1, tag) {
  const h = (headingDeg * Math.PI) / 180;
  out.x = x;
  out.z = z;
  out.fx = Math.sin(h);
  out.fz = -Math.cos(h);
  out.hl = hl;
  out.hw = hw;
  out.y0 = y0;
  out.y1 = y1;
  out.tag = tag || '';
  return out;
}

function outOfSolid(x, z, r, s) {
  const px = x - s.x;
  const pz = z - s.z;
  // Local frame: `a` along the nose, `b` to the right.
  const a = px * s.fx + pz * s.fz;
  const b = px * -s.fz + pz * s.fx;
  // Cheap reject first.
  if (a > s.hl + r || a < -s.hl - r || b > s.hw + r || b < -s.hw - r) return false;
  if (!outOfBox(a, b, r, -s.hl, s.hl, -s.hw, s.hw)) return false;
  const na = _p.x;
  const nb = _p.z;
  _p.x = s.x + na * s.fx - nb * s.fz;
  _p.z = s.z + na * s.fz + nb * s.fx;
  return true;
}

/**
 * Is a circle at (x, z), feet at y, touching anything solid? Returns the box,
 * or null. For the camera and the tests; the walker itself resolves.
 */
export function solidAt(x, z, y, r = 0.1, solids = null, height = WALK.height) {
  refreshNear(x, z);
  const top = y + height;
  for (let i = 0; i < NEAR.length; i++) {
    const o = NEAR[i];
    if (y >= o.y1 || top <= o.y0) continue;
    if (x + r > o.x0 && x - r < o.x1 && z + r > o.z0 && z - r < o.z1) return o;
  }
  for (let i = 0; i < NEARP.length; i++) {
    const o = NEARP[i];
    if (y >= o.y1 || top <= o.y0) continue;
    if (x + r <= o.x0 || x - r >= o.x1 || z + r <= o.z0 || z - r >= o.z1) continue;
    if (inOriented(o, x, z, r) && shown(o.obj)) return o;
  }
  if (solids) {
    for (let i = 0; i < solids.length; i++) {
      const s = solids[i];
      if (y >= s.y1 || top <= s.y0) continue;
      const px = x - s.x;
      const pz = z - s.z;
      const a = px * s.fx + pz * s.fz;
      const b = px * -s.fz + pz * s.fx;
      if (Math.abs(a) < s.hl + r && Math.abs(b) < s.hw + r) return s;
    }
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* The walker                                                          */
/* ------------------------------------------------------------------ */

export class Walker {
  constructor() {
    this.x = 0;
    this.y = 0;
    this.z = 0;
    /** Compass degrees the body faces. */
    this.heading = 0;
    this.vx = 0;
    this.vz = 0;
    this.vy = 0;
    this.air = false;
    this.wading = false;
    /** Metres walked, and the last thing that stopped us, for the tests. */
    this.walked = 0;
    this.lastBlock = '';
    this.bumped = 0;
  }

  place(x, z, headingDeg = 0) {
    this.x = x;
    this.z = z;
    this.y = floorAt(x, z);
    this.heading = headingDeg;
    this.vx = 0;
    this.vz = 0;
    this.vy = 0;
    this.air = false;
    this.lastBlock = '';
    return this;
  }

  get speed() {
    return Math.hypot(this.vx, this.vz);
  }

  /**
   * One frame.
   *
   * @param {number} dt
   * @param {number} mx  wanted direction, world x, length 0..1
   * @param {number} mz  wanted direction, world z
   * @param {boolean} run
   * @param {boolean} jump  pressed this frame
   * @param {Array} solids oriented boxes (see solidBox), may be empty
   */
  step(dt, mx, mz, run, jump, solids) {
    if (!(dt > 0)) return;
    // The baggage trains that drive round the apron are where they are now.
    tickProps();
    const len = Math.hypot(mx, mz);
    if (len > 1) {
      mx /= len;
      mz /= len;
    }
    const top = run ? WALK.run : WALK.walk;
    const wade = this.wading ? WALK.wade : 1;
    const wantX = mx * top * wade;
    const wantZ = mz * top * wade;
    // The legs have to get going; in the air you keep what you had.
    const k = Math.min(1, dt * (this.air ? 1.5 : WALK.accel));
    this.vx += (wantX - this.vx) * k;
    this.vz += (wantZ - this.vz) * k;

    // Turn the body toward where it is going, the short way round.
    if (len > 0.05) {
      const want = (Math.atan2(mx, -mz) * 180) / Math.PI;
      let d = want - this.heading;
      while (d > 180) d -= 360;
      while (d < -180) d += 360;
      const turn = Math.min(Math.abs(d), 600 * dt);
      this.heading = (this.heading + Math.sign(d) * turn + 360) % 360;
    }

    if (jump && !this.air) {
      this.vy = WALK.jump;
      this.air = true;
    }

    // Split long moves so a tab that stalled for a quarter second cannot
    // carry the walker through a wall in one stride.
    const dist = Math.hypot(this.vx, this.vz) * dt;
    const n = Math.min(8, Math.max(1, Math.ceil(dist / WALK.maxStep)));
    const sdt = dt / n;
    const x0 = this.x;
    const z0 = this.z;
    for (let i = 0; i < n; i++) this.move(sdt, solids);

    /*
     * Blocked, the legs stop. The velocity was what the keys asked for, not
     * what happened: walking into the terminal, a wing or the sea kept it at
     * 1.8 m/s (5.2 running) and the walker ran on the spot against the wall
     * with the footsteps going. Measured before: pressed against the terminal
     * for a second, speed 1.8 m/s and the stride animation fully on. Now it
     * is what the walker actually moved — the part along a wall stays, so
     * sliding along one still walks. Only ever slower: a baggage cart
     * nudging the walker along does not make the legs run.
     */
    const ax = (this.x - x0) / dt;
    const az = (this.z - z0) / dt;
    if (Math.hypot(ax, az) < Math.hypot(this.vx, this.vz) - 0.02) {
      this.vx = ax;
      this.vz = az;
    }

    // Up and down.
    const g = floorAt(this.x, this.z);
    if (this.air) {
      this.vy -= WALK.gravity * dt;
      this.y += this.vy * dt;
      if (this.y <= g) {
        this.y = g;
        this.vy = 0;
        this.air = false;
      }
    } else if (g < this.y - 0.45) {
      // Stepped off something: fall.
      this.air = true;
      this.vy = 0;
    } else {
      this.y = g;
    }
    this.wading = heightAt(this.x, this.z) < -0.05;
  }

  move(dt, solids) {
    const ox = this.x;
    const oz = this.z;
    let nx = ox + this.vx * dt;
    let nz = oz + this.vz * dt;
    const r = WALK.radius;

    refreshNear(nx, nz);
    const y = this.y;
    const top = y + WALK.height;
    // Two passes: a corner between two boxes needs the second.
    for (let pass = 0; pass < 2; pass++) {
      let moved = false;
      for (let i = 0; i < NEAR.length; i++) {
        const o = NEAR[i];
        if (y >= o.y1 || top <= o.y0) continue;
        if (nx + r <= o.x0 || nx - r >= o.x1 || nz + r <= o.z0 || nz - r >= o.z1) continue;
        if (outOfBox(nx, nz, r, o.x0, o.x1, o.z0, o.z1)) {
          nx = _p.x;
          nz = _p.z;
          moved = true;
          this.lastBlock = o.what || 'a wall';
        }
      }
      for (let i = 0; i < NEARP.length; i++) {
        const o = NEARP[i];
        if (y >= o.y1 || top <= o.y0) continue;
        if (nx + r <= o.x0 || nx - r >= o.x1 || nz + r <= o.z0 || nz - r >= o.z1) continue;
        if (!shown(o.obj)) continue;
        if (outOfSolid(nx, nz, r, o)) {
          nx = _p.x;
          nz = _p.z;
          moved = true;
          this.lastBlock = o.what || 'something in the way';
        }
      }
      if (solids) {
        for (let i = 0; i < solids.length; i++) {
          const s = solids[i];
          if (y >= s.y1 || top <= s.y0) continue;
          if (outOfSolid(nx, nz, r, s)) {
            nx = _p.x;
            nz = _p.z;
            moved = true;
            this.lastBlock = s.tag || 'something parked';
          }
        }
      }
      if (!moved) break;
    }
    if (nx !== ox + this.vx * dt || nz !== oz + this.vz * dt) this.bumped++;

    // Water and cliffs. Try the whole step, then each axis on its own, so a
    // walker pressed diagonally against a shoreline slides along it.
    if (!this.canStand(ox, oz, nx, nz)) {
      if (this.canStand(ox, oz, nx, oz)) nz = oz;
      else if (this.canStand(ox, oz, ox, nz)) nx = ox;
      else {
        nx = ox;
        nz = oz;
      }
    }
    this.walked += Math.hypot(nx - ox, nz - oz);
    this.x = nx;
    this.z = nz;
  }

  /** May the walker go from (ox, oz) to (nx, nz)? */
  canStand(ox, oz, nx, nz) {
    if (nx === ox && nz === oz) return true;
    if (heightAt(nx, nz) < WALK.deep) {
      this.lastBlock = 'deep water';
      return false;
    }
    if (!this.air) {
      /*
       * Steepness over a fixed 0.6 m probe, not over this frame's step. The
       * first version compared the rise against the step, with a kerb's worth
       * of allowance on top — and a step at 60 fps is 3 cm, so that allowance
       * came round every frame and the walker went up a cliff at ten metres a
       * second. A kerb (up to 35 cm) is always fine; anything steeper than
       * WALK.maxRise that is also taller than a kerb is not.
       */
      const dx = nx - ox;
      const dz = nz - oz;
      const d = Math.hypot(dx, dz);
      const rise = floorAt(ox + (dx / d) * 0.6, oz + (dz / d) * 0.6) - this.y;
      if (rise > 0.35 && rise > 0.6 * WALK.maxRise) {
        this.lastBlock = 'too steep';
        return false;
      }
    }
    return true;
  }
}

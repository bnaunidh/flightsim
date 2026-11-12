/**
 * The terminal, dressed (the owner: "make the terminals etc look good and the
 * outside also good"). look.js draws the building; this furnishes it:
 *
 *   inside   timber beams and light strips under the high ceilings, oak
 *            panelling on the hall's long wall, a lit canopy over each check-in
 *            island, self-service kiosks and planters at the hall's columns,
 *            lights and posters down the arrivals corridor, a roped boarding
 *            lane at each gate
 *   outside  the island's palms and a clipped hedge on the grass across the kerb
 *            road, a planted bed along the foot of the kerb wall, and the
 *            airlines' names beside each entrance
 *
 * All of it goes into meshes the building already has (inside) or two more
 * that only a walker ever sees (outside), so the seat pays nothing: this file
 * is fetched with the rest of terminal/ when somebody on foot comes near.
 * Whatever a walker should not pass through comes back as `solids`, in the
 * plan's own frame, for interior.js's grid.
 */
import * as THREE from '../../vendor/three.module.js';
import { treeGeometry } from '../../world/scenery.js';
import { landsideRing } from '../../world/airport-layout.js';
import { groundHeightAt } from '../../world/terrain.js';
import { DOOR } from '../life/doors.js';
import { landsidePlan } from '../life/landside-plan.js';
import { UP, FLOOR, CEIL, CEIL_LOW, spans } from './plan.js';
import { passengerAirlines } from './atlas.js';

const WOOD = 0xa9835c;
const OAK = 0xc7a983;
const OAK_2 = 0xbb9c76;
const STEEL = 0x8c939b;
const DARK = 0x2b2f35;
const STONE = 0xc9c5bc;
const LIGHT = 0xfffdf0;
const LEAF = [0x3f7d4a, 0x4f9259, 0x2f6a3e];
/** Out of doors, in the sun: the greens the island's own trees are. */
const HEDGE = [0x38662a, 0x47782f, 0x2f5a26];
/** Metres between beams. */
const BAY = 6;

/** A planter: a stone box with a clipped box hedge in it, the top a shade lighter. */
function planter(R, u, b, y, hw = 0.5, tall = 1.3) {
  R.box(u - hw, u + hw, b - 0.42, b + 0.42, y, y + 0.55, STONE, 0.9);
  R.box(u - hw + 0.06, u + hw - 0.06, b - 0.36, b + 0.36, y + 0.55, y + 0.6, 0x4a3b2c, 1);
  R.box(u - hw + 0.1, u + hw - 0.1, b - 0.32, b + 0.32, y + 0.6, y + tall, LEAF[2], 0.8);
  R.box(u - hw + 0.1, u + hw - 0.1, b - 0.32, b + 0.32, y + tall, y + tall + 0.02, LEAF[0], 1);
}

/** Posts and a belt: a queue's rope line along b. */
function rope(R, u, b0, b1, y) {
  const n = Math.max(1, Math.round((b1 - b0) / 1.3));
  for (let i = 0; i <= n; i++) {
    const b = b0 + ((b1 - b0) * i) / n;
    R.box(u - 0.04, u + 0.04, b - 0.04, b + 0.04, y, y + 0.98, STEEL);
    R.box(u - 0.14, u + 0.14, b - 0.14, b + 0.14, y, y + 0.03, 0x3a3f46, 1);
  }
  R.box(u - 0.015, u + 0.015, b0, b1, y + 0.88, y + 0.94, 0x2d4f7f);
}

/** A light let into a ceiling: a dark trough with a bright strip in it. */
function light(R, u0, u1, b0, b1, y) {
  R.box(u0 - 0.08, u1 + 0.08, b0 - 0.08, b1 + 0.08, y - 0.05, y, 0x3a3f46, 1);
  R.flat(u0, u1, b0, b1, y - 0.056, LIGHT, 2.4, R.fit, true, 1.16);
}

/** Furnish the inside. Returns what is solid: [{ u0, u1, b0, b1, y0, y1, tag }]. */
export function dressInside(R) {
  const P = R.P;
  const A = R.atlas;
  const { D, B, cu0, cu1, shopB0, walkB0 } = P;
  const solids = [];
  const solid = (u0, u1, b0, b1, y0, y1, tag) => solids.push({ u0, u1, b0, b1, y0, y1, tag });
  const up = UP + FLOOR;
  const loungeU = P.lounge.u0;

  /* ---- the high ceilings: beams across, a light between each pair ---- */
  for (let u = cu0 + 3; u < cu1 - 1; u += BAY) {
    R.box(u - 0.14, u + 0.14, B + 0.3, D - 0.4, CEIL - 0.6, CEIL, WOOD, 1);
    if (u + BAY / 2 < cu1 - 1) light(R, u + BAY / 2 - 0.16, u + BAY / 2 + 0.16, B + 2.5, D - 2.5, CEIL);
    if (u > loungeU - 0.5) continue;
    R.box(u - 0.14, u + 0.14, 0.4, shopB0 - 0.25, CEIL - 0.6, CEIL, WOOD, 1);
    if (u + BAY / 2 < loungeU - 0.5) light(R, u + BAY / 2 - 0.16, u + BAY / 2 + 0.16, 1.6, shopB0 - 1.4, CEIL);
  }

  /* ---- oak on the hall's long wall, above the doors and the posters ---- */
  const c0 = (P.secGap.a + P.secGap.b) / 2;
  for (const [a, c] of spans(cu0 + 0.2, cu1 - 0.2, [{ a: c0 - 6.1, b: c0 + 6.1 }])) {
    const n = Math.max(1, Math.round((c - a) / 1.5));
    const w = (c - a) / n;
    for (let i = 0; i < n; i++) R.box(a + i * w + 0.02, a + (i + 1) * w - 0.02, B + 0.15, B + 0.21, 5.05, CEIL - 1.5, i % 2 ? OAK : OAK_2, 0.94);
    R.box(a, c, B + 0.15, B + 0.23, 4.95, 5.05, DARK, 1);
  }

  /* ---- check-in: a lit canopy over each island ---- */
  for (const isl of P.islands) {
    const { u0, u1, b } = isl;
    R.box(u0 - 0.2, u1 + 0.2, b - 1.4, b + 1.5, 2.9, 3.08, 0xf1f2f2, 1);
    R.box(u0 - 0.2, u1 + 0.2, b + 1.5, b + 1.56, 2.78, 3.1, 0x2d4f7f, 1);
    R.box(u0 + 0.4, u1 - 0.4, b + 0.5, b + 0.8, 2.87, 2.9, LIGHT, 1);
    // Over a walker's head, but not over the camera's.
    solid(u0 - 0.2, u1 + 0.2, b - 1.4, b + 1.56, 2.78, 3.1, 'the check-in canopy');
  }

  /* ---- the hall's columns: kiosks at one, planters at the next ---- */
  let k = 0;
  for (const c of P.columns) {
    if (c.b < B) continue;
    k++;
    if (P.land.some((d) => Math.abs(d.u - c.u) < 5.5)) continue;
    for (const s of [-1, 1]) {
      const u = c.u + s * 1.3;
      if (k % 2) {
        // A self-service kiosk, its screen to the doors.
        R.box(u - 0.3, u + 0.3, c.b - 0.22, c.b + 0.22, 0, 1.05, 0x2d4f7f);
        R.box(u - 0.3, u + 0.3, c.b - 0.22, c.b + 0.1, 1.05, 1.5, 0x2d4f7f);
        R.box(u - 0.24, u + 0.24, c.b + 0.1, c.b + 0.13, 1.0, 1.45, 0x101215, 1);
        R.box(u - 0.2, u + 0.2, c.b + 0.13, c.b + 0.14, 1.06, 1.4, 0x8fd0ee, 1);
        R.box(u - 0.2, u + 0.2, c.b + 0.22, c.b + 0.3, 0.8, 0.84, 0xd9dcde, 1);
        solid(u - 0.3, u + 0.3, c.b - 0.22, c.b + 0.3, 0, 1.5, 'a check-in kiosk');
      } else {
        planter(R, u + s * 0.2, c.b, FLOOR, 0.6);
        solid(u + s * 0.2 - 0.6, u + s * 0.2 + 0.6, c.b - 0.42, c.b + 0.42, 0, 1.5, 'a planter');
      }
    }
  }

  /* ---- the low ceilings: a light every bay; posters down the corridor ---- */
  for (const r of P.lower) {
    if (r.b0 >= B) continue;
    const alongU = r.u1 - r.u0 > r.b1 - r.b0;
    const mb = (r.b0 + r.b1) / 2;
    const mu = (r.u0 + r.u1) / 2;
    if (alongU) for (let u = r.u0 + 3; u < r.u1 - 2; u += BAY) light(R, u - 0.9, u + 0.9, mb - 0.14, mb + 0.14, CEIL_LOW);
    else for (let b = r.b0 + 2; b < r.b1 - 1; b += 4) light(R, mu - 0.14, mu + 0.14, b - 0.7, b + 0.7, CEIL_LOW);
  }
  let ad = 1;
  for (const w of P.walls) {
    if (w.axis !== 'u' || w.y0 !== 0 || w.y1 > CEIL_LOW || w.at > 4 || w.hi - w.lo < 12) continue;
    const n = Math.max(1, Math.floor((w.hi - w.lo) / 20));
    for (let i = 0; i < n; i++) {
      const u = w.lo + ((i + 0.5) * (w.hi - w.lo)) / n;
      R.box(u - 2.1, u + 2.1, w.at - 0.22, w.at - 0.15, 1.35, 3.45, DARK);
      R.panel(u, w.at - 0.22, 'b-', 4, 1.45, 3.35, A.rect(`ad:${ad++ % 4}`), 0xffffff, R.fit, 0.01);
    }
    // A handrail-high band, so the corridor has a line to it.
    R.box(w.lo, w.hi, w.at - 0.19, w.at - 0.15, 1.2, 1.26, 0x2d4f7f, 1);
  }

  /* ---- the gates: a roped lane to each bridge, planters between the seats ---- */
  for (const g of P.gates) {
    for (const s of [-1, 1]) rope(R, g.link + s * 1.25, 0.9, 3.5, up);
    R.flat(g.link - 1.1, g.link + 1.1, 0.5, 3.6, up + 0.014, 0x2d4f7f, 2.4, R.fit, false, 0.8);
  }
  return solids;
}

/**
 * Dress the kerb. `R` is a second Room (its `fit` takes the lit signs), `v` a
 * Batch for what the sun lights. Returns the solids, in the plan's frame
 * (b past D is out on the kerb).
 */
export function dressOutside(R, v) {
  const P = R.P;
  const A = R.atlas;
  const T = P.T;
  const { D } = P;
  const e = R.e;
  const solids = [];
  const slab = (u0, u1, b0, b1, y0, y1, hex) => v.slab(R.x(u0), R.x(u1), e + y0, e + y1, R.z(b0), R.z(b1), hex);
  const plan = landsidePlan(P.lay);
  const ring = landsideRing(P.lay);
  if (!plan || !ring) return solids;

  /* ---- a planted bed along the foot of the wall, clear of the doors and the benches ---- */
  const half = DOOR.land.wide + 3.2;
  const gaps = plan.doors.map((c) => ({ a: c - half, b: c + half }));
  for (const it of plan.items) if (it.w < 2) gaps.push({ a: it.u - 1.5, b: it.u + 1.5 });
  for (const [a, c] of spans(T.u0 + 1, T.u1 - 1, gaps)) {
    if (c - a < 2) continue;
    slab(a, c, D + 0.42, D + 1.0, -0.1, 0.3, STONE);
    slab(a + 0.08, c - 0.08, D + 0.46, D + 0.92, 0.3, 0.74, HEDGE[0]);
    // Taller clumps along it, so it is not a green kerbstone.
    for (let u = a + 1.2; u < c - 1; u += 3.4) slab(u - 0.5, u + 0.5, D + 0.44, D + 0.94, 0.74, 0.98 + 0.12 * (Math.round(u) & 1), HEDGE[1 + (Math.round(u) & 1)]);
    solids.push({ u0: a, u1: c, b0: D + 0.42, b1: D + 1.0, y0: -0.2, y1: 0.9, tag: 'a planted bed' });
  }

  /* ---- who flies from here, beside each entrance ---- */
  const lines = passengerAirlines();
  plan.doors.forEach((c, n) => {
    for (const s of [-1, 1]) {
      const u = c + s * (DOOR.land.wide + 1.9);
      R.box(u - 1.02, u + 1.02, D + 0.42, D + 0.5, 0.86, 2.5, DARK);
      for (let i = 0; i < 3 && lines.length; i++) {
        const l = lines[(n * 6 + (s > 0 ? 3 : 0) + i) % lines.length];
        R.panel(u, D + 0.5, 'b+', 1.9, 0.92 + i * 0.52, 1.4 + i * 0.52, A.rect(`airline:${l.id}`), 0xffffff, R.fit, 0.01);
      }
    }
  });

  /* ---- across the road: a row of palms (the island's own: scenery.js), a hedge between them ---- */
  const w = ring.nearW + ring.hw;
  const tw = w + 4.2;
  const keep = [...plan.doors.map((c) => ({ a: c - 9, b: c + 9 })), { a: ring.mid - 6, b: ring.mid + 6 }];
  const free = (u, r) => keep.every((g) => u + r < g.a || u - r > g.b);
  const lo = ring.mid - ring.L + 14;
  const hi = ring.mid + ring.L - 14;
  const spots = [];
  let i = 0;
  for (let u = lo; u <= hi; u += 11, i++) {
    if (!free(u, 1)) continue;
    const x = R.x(u);
    const z = R.z(D + tw);
    const y = groundHeightAt(x, z);
    if (Math.abs(y - e) > 1.5) continue;
    spots.push({ x, y, z, rot: i * 2.4, h: 7.2 + (i % 3) * 0.7 });
    v.box(1.6, 0.14, 1.6, x, y + 0.03, z, 0x4a3b2c);
    solids.push({ u0: u - 0.3, u1: u + 0.3, b0: D + tw - 0.3, b1: D + tw + 0.3, y0: -1, y1: 5, tag: 'a palm' });
  }
  solids.trees = spots;
  for (const [a, c] of spans(lo - 4, hi + 4, keep)) {
    if (c - a < 4) continue;
    const y = groundHeightAt(R.x((a + c) / 2), R.z(D + w + 1.3)) - e;
    if (Math.abs(y) > 1.5) continue;
    slab(a, c, D + w + 0.9, D + w + 1.7, y - 0.2, y + 0.8, HEDGE[2]);
    solids.push({ u0: a, u1: c, b0: D + w + 0.9, b1: D + w + 1.7, y0: -1, y1: y + 0.8, tag: 'a hedge' });
  }
  return solids;
}

/** The palms at `spots` ({ x, y, z, rot, h }), one draw call: the island's own palm, so they match the coast's. */
export function kerbPalms(spots, cast = true) {
  if (!spots || !spots.length) return null;
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0, side: THREE.DoubleSide });
  const mesh = new THREE.InstancedMesh(treeGeometry(0), mat, spots.length);
  mesh.name = 'kerb:palms';
  mesh.castShadow = cast;
  mesh.receiveShadow = false;
  const d = new THREE.Object3D();
  spots.forEach((s, i) => {
    d.position.set(s.x, s.y - 0.2, s.z);
    d.rotation.set(0, s.rot, 0);
    d.scale.setScalar(s.h);
    d.updateMatrix();
    mesh.setMatrixAt(i, d.matrix);
  });
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingSphere();
  return mesh;
}

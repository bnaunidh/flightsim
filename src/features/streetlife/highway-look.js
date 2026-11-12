/**
 * Highways, drawn: what world/highway-plan.js planned.
 *
 *   a LINK's dress   the concrete barrier down the median and the dashed white lane line
 *                    on each carriageway: two meshes a link (concrete, paint);
 *   a FLYOVER        the paved gore where the through lane leaves the carriageway, the
 *                    ramp between its retaining walls, the deck on its piers with a
 *                    parapet each side and a barrier down the middle, and the local road
 *                    underneath: three meshes (concrete, tarmac, paint).
 *
 * Each is built about a point of its own (a group at its middle, as
 * worldmap/network-look.js does) so no vertex is far from its origin, and nothing here
 * moves once built: features/street-life.js shows and hides whole groups by distance.
 * The tarmac is the road's own material (roads.js's asphalt, world-mapped), so a deck
 * and the carriageway it leaves are the same surface.
 */
import * as THREE from '../../vendor/three.module.js';
import { Batch, vcMaterial } from '../../world/airport-kit.js';
import { stationAt, barrierRuns, DECK_HALF, WALL_TO, CROSS_HALF } from '../../world/highway-plan.js';

const CONC = 0xb7b4ab;
const DARK = 0x7b7973;
const ASPH = 0x44474b;
const WHITE = 0xeceae2;

let PAINT = null;
let CONCRETE = null;
let PLAIN_TARMAC = null;
function paintMat() {
  if (!PAINT) PAINT = new THREE.MeshStandardMaterial({ color: WHITE, roughness: 0.75, metalness: 0, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -8, side: THREE.DoubleSide });
  return PAINT;
}
function concreteMat() {
  if (!CONCRETE) CONCRETE = vcMaterial({ roughness: 0.92, side: THREE.DoubleSide });
  return CONCRETE;
}
function plainTarmac() {
  if (!PLAIN_TARMAC) PLAIN_TARMAC = new THREE.MeshStandardMaterial({ color: ASPH, roughness: 0.92, metalness: 0, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4, side: THREE.DoubleSide });
  return PLAIN_TARMAC;
}

const UV0 = [0, 0, 1, 1];
/** A quad whose corners carry world-mapped UVs (10 m a repeat, as the road's asphalt). */
function worldQuad(b, a, c, d, e, ox, oz) {
  const uv = (p) => [(p[0] + ox) / 10, (p[2] + oz) / 10];
  b.tri(a, c, d, uv(a), uv(c), uv(d));
  b.tri(a, d, e, uv(a), uv(d), uv(e));
}

/** A concrete barrier's section from p to q (centre line points [x, y, z] at its foot), `nx, nz` across: two faces and a top. */
function barrier(b, p, q, pn, qn, h = 0.85, foot = 0.32, top = 0.11, colour = CONC) {
  const at = (c, n, o, y) => [c[0] + n[0] * o, c[1] + y, c[2] + n[1] * o];
  for (const side of [-1, 1]) {
    const a0 = at(p, pn, side * foot, 0);
    const a1 = at(q, qn, side * foot, 0);
    const t0 = at(p, pn, side * top, h);
    const t1 = at(q, qn, side * top, h);
    if (side < 0) b.quad(a1, a0, t0, t1, UV0, colour);
    else b.quad(a0, a1, t1, t0, UV0, colour);
  }
  b.quad(at(p, pn, -top, h), at(p, pn, top, h), at(q, qn, top, h), at(q, qn, -top, h), UV0, colour);
}

/**
 * A link's barrier and lane lines. `surface(x, z)` is the top of the tarmac there (the
 * road ribbon's own, read back from its mesh), `every` the metres from one dash to the next.
 * `paint: false` leaves the lane lines out (Low).
 */
export function buildLinkDress(link, { surface, paint = true, every = 15, shadows = false } = {}) {
  const st = link.stations;
  const mid = st[st.length >> 1];
  const ox = mid.x;
  const oz = mid.z;
  const grp = new THREE.Group();
  grp.name = `highway:${link.name}`;
  grp.position.set(ox, 0, oz);
  const conc = new Batch();
  let barrierM = 0;
  for (const [i0, i1] of barrierRuns(link)) {
    for (let i = i0; i + 3 <= i1; i += 3) {
      const a = st[i];
      const c = st[Math.min(i1, i + 3)];
      barrier(conc, [a.x - ox, a.y - 0.08, a.z - oz], [c.x - ox, c.y - 0.08, c.z - oz], [a.nx, a.nz], [c.nx, c.nz]);
      barrierM += c.s - a.s;
    }
  }
  const cm = conc.mesh(concreteMat(), { cast: shadows, receive: true, name: 'highway-barrier' });
  if (cm) grp.add(cm);
  let dashes = 0;
  if (paint && surface) {
    const pb = new Batch();
    const P = {};
    const Q = {};
    const DASH = 5;
    const W = 0.075;
    for (let s = 40; s + DASH < link.length - 40; s += every) {
      stationAt(link, s, P);
      stationAt(link, s + DASH, Q);
      for (const side of [-1, 1]) {
        const ax = P.x + P.nx * P.half * side;
        const az = P.z + P.nz * P.half * side;
        const bx = Q.x + Q.nx * Q.half * side;
        const bz = Q.z + Q.nz * Q.half * side;
        const ay = surface(ax, az) + 0.02;
        const by = surface(bx, bz) + 0.02;
        if (!Number.isFinite(ay) || !Number.isFinite(by)) continue;
        pb.quad([ax - P.nx * W - ox, ay, az - P.nz * W - oz], [ax + P.nx * W - ox, ay, az + P.nz * W - oz], [bx + Q.nx * W - ox, by, bz + Q.nz * W - oz], [bx - Q.nx * W - ox, by, bz - Q.nz * W - oz]);
        dashes++;
      }
    }
    const pm = pb.mesh(paintMat(), { cast: false, receive: true, name: 'highway-lanes' });
    // (Wound for whichever way the carriageway runs: the paint is seen from above either way.)
    if (pm) {
      grp.add(pm);
      grp.userData.paint = pm;
    }
  }
  let r = 0;
  for (let i = 0; i < st.length; i += 20) r = Math.max(r, Math.hypot(st[i].x - ox, st[i].z - oz));
  grp.userData = { ...grp.userData, kind: 'link', x: ox, z: oz, r, barrierM: Math.round(barrierM), dashes };
  return grp;
}

/**
 * A flyover. `tarmac` is the material its road surface wears (the road ribbon's own; a plain
 * dark one without), `lift` the tarmac's height over the ground (roads.js's for this map).
 */
export function buildFlyoverLook(fly, { tarmac = null, lift = 0.25, shadows = false } = {}) {
  const ox = fly.mid.x;
  const oz = fly.mid.z;
  const grp = new THREE.Group();
  grp.name = `flyover:${fly.link}`;
  grp.position.set(ox, 0, oz);
  const conc = new Batch();
  const road = new Batch();
  const paint = new Batch();
  const D = fly.deck;
  const at = (p, o, y) => [p.x + p.nx * o - ox, y, p.z + p.nz * o - oz];
  for (let i = 1; i < D.length; i++) {
    const a = D[i - 1];
    const c = D[i];
    const up = Math.max(a.lift, c.lift);
    const ya = a.y + 0.012;
    const yc = c.y + 0.012;
    // The surface: the paved median (the gore) where the lane crosses it, the deck where it has left the ground.
    const wa = a.lift > 0.02 ? DECK_HALF : a.half - 4.6;
    const wc = c.lift > 0.02 ? DECK_HALF : c.half - 4.6;
    worldQuad(road, at(a, -wa, ya), at(a, wa, ya), at(c, wc, yc), at(c, -wc, yc), ox, oz);
    // The barrier between the two ways, the whole length.
    barrier(conc, [a.x - ox, a.y, a.z - oz], [c.x - ox, c.y, c.z - oz], [a.nx, a.nz], [c.nx, c.nz], 0.85, 0.28, 0.1);
    // Edge lines: beside the barrier, and inside each parapet once there is one.
    for (const o of [-0.62, 0.5]) paint.quad(at(a, o, ya + 0.012), at(a, o + 0.12, ya + 0.012), at(c, o + 0.12, yc + 0.012), at(c, o, yc + 0.012));
    if (up < 0.05) continue;
    for (const side of [-1, 1]) {
      const o = side * DECK_HALF;
      const flip = (p, q, r, s) => (side > 0 ? conc.quad(p, q, r, s, UV0, CONC) : conc.quad(q, p, s, r, UV0, CONC));
      // Below the surface: a retaining wall down to the ground, or the deck's edge with air under it.
      const openA = a.lift > WALL_TO;
      const openC = c.lift > WALL_TO;
      const fa = openA ? ya - 1.25 : a.ground - 0.4;
      const fc = openC ? yc - 1.25 : c.ground - 0.4;
      flip(at(a, o, fa), at(c, o, fc), at(c, o, yc + 0.95), at(a, o, ya + 0.95));
      // The parapet's top and its inner face.
      const oi = side * (DECK_HALF - 0.3);
      flip(at(a, oi, ya + 0.95), at(a, o, ya + 0.95), at(c, o, yc + 0.95), at(c, oi, yc + 0.95));
      flip(at(c, oi, yc), at(a, oi, ya), at(a, oi, ya + 0.95), at(c, oi, yc + 0.95));
      const ol = side * (DECK_HALF - 0.75);
      paint.quad(at(a, ol - 0.06, ya + 0.012), at(a, ol + 0.06, ya + 0.012), at(c, ol + 0.06, yc + 0.012), at(c, ol - 0.06, yc + 0.012));
    }
    // The deck's underside where it is open, and the wall across where the solid ramp ends.
    if (a.lift > WALL_TO && c.lift > WALL_TO) conc.quad(at(a, DECK_HALF, ya - 1.25), at(a, -DECK_HALF, ya - 1.25), at(c, -DECK_HALF, yc - 1.25), at(c, DECK_HALF, yc - 1.25), UV0, DARK);
    else if (a.lift > WALL_TO !== c.lift > WALL_TO) {
      const p = a.lift > WALL_TO ? c : a;
      const y = p.y - 1.25;
      const q = [at(p, -DECK_HALF, p.ground - 0.4), at(p, DECK_HALF, p.ground - 0.4), at(p, DECK_HALF, y), at(p, -DECK_HALF, y)];
      // Faces the open span: up the road for the first ramp, back down it for the second.
      if (c.lift > a.lift) conc.quad(q[1], q[0], q[3], q[2], UV0, DARK);
      else conc.quad(q[0], q[1], q[2], q[3], UV0, DARK);
    }
  }
  // Piers: a column in the median and a hammerhead across under the deck.
  for (const p of fly.piers) {
    const h = p.top - 1.3 - (p.ground - 0.5);
    if (h > 0.4) conc.box(2.1, h, 1.5, p.x - ox, p.ground - 0.5 + h / 2, p.z - oz, CONC, p.ry);
    conc.box(1.9, 1.3, DECK_HALF * 2 - 1.2, p.x - ox, p.top - 0.65, p.z - oz, DARK, p.ry);
  }
  // The local road underneath: tarmac from one end to the other, save where the carriageways already are.
  const C = fly.cross;
  const m = D[D.length >> 1];
  let crossM = 0;
  for (let i = 1; i < C.length; i++) {
    const a = C[i - 1];
    const c = C[i];
    const o = Math.abs(((a[0] + c[0]) / 2 - m.x) * m.nx + ((a[1] + c[1]) / 2 - m.z) * m.nz);
    if (o > m.half - 5.4 && o < m.half + 5.4) continue;
    const q = (p, w) => [p[0] + m.tx * w - ox, p[2] + 0.012, p[1] + m.tz * w - oz];
    worldQuad(road, q(a, CROSS_HALF), q(a, -CROSS_HALF), q(c, -CROSS_HALF), q(c, CROSS_HALF), ox, oz);
    if (o > m.half + 5.4) for (const w of [-CROSS_HALF + 0.3, CROSS_HALF - 0.42]) paint.quad([q(a, w + 0.12)[0], a[2] + 0.03, q(a, w + 0.12)[2]], [q(a, w)[0], a[2] + 0.03, q(a, w)[2]], [q(c, w)[0], c[2] + 0.03, q(c, w)[2]], [q(c, w + 0.12)[0], c[2] + 0.03, q(c, w + 0.12)[2]]);
    crossM += Math.hypot(c[0] - a[0], c[1] - a[1]);
  }
  const cm = conc.mesh(concreteMat(), { cast: shadows, receive: true, name: 'flyover-structure' });
  const rm = road.mesh(tarmac || plainTarmac(), { cast: false, receive: true, name: 'flyover-road' });
  const pm = paint.mesh(paintMat(), { cast: false, receive: false, name: 'flyover-paint' });
  for (const x of [cm, rm, pm]) if (x) grp.add(x);
  grp.userData = { kind: 'flyover', x: ox, z: oz, r: fly.deck.length * 2.5 + 120, piers: fly.piers.length, crossM: Math.round(crossM), top: fly.mid.y, lift };
  return grp;
}

/** Free what a group built here holds (the shared materials stay). */
export function disposeLook(grp) {
  if (!grp) return;
  if (grp.parent) grp.parent.remove(grp);
  grp.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
  });
}

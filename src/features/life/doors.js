/**
 * The terminal's doors: where they are (pure numbers, for the crowd's routes,
 * the turnaround and the walk-in) and the lobbies and sliding leaves themselves.
 */
import * as THREE from '../../vendor/three.module.js';
import { Batch, vcMaterial } from '../../world/airport-kit.js';
import { AIRPORT } from '../../world/terrain.js';

const _m = new THREE.Matrix4();
const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();

/**
 * The sizes of the terminal's doors, metres.
 *   air    an apron door: a glazed lobby built out from the front wall, at the
 *          foot of each jet bridge, where the stairs and the walk across the
 *          apron come in
 *   land   a kerb door: two sets of sliding doors in each of the two entrances
 *          under the canopy
 * `depth` is how far the lobby stands out of the wall (the sliding doors are
 * on its outer face), `hw` the clear half-width of the opening, `h` its height.
 */
export const DOOR = Object.freeze({
  air: Object.freeze({ hw: 1.15, h: 2.5, depth: 2.6, wide: 2.3 }),
  land: Object.freeze({ hw: 1.6, h: 3.0, depth: 2.4, wide: 7.2 }),
});

/** Along the wall from a stand's rotunda to its apron door, metres. */
const DOOR_PAST_ROTUNDA = 5.5;

/**
 * Every door people use at this terminal, pure numbers, so the building
 * (world/apron.js), the crowd's routes (features/life/plan.js), the turnaround
 * (features/passengers) and the walk-in all agree where they are:
 *
 *   { id, side: 'air'|'land', stand, u, x, z, y0, nx, nz, hw, h,
 *     out: { x, z }  3.5 m clear of the doors: where you line up on them
 *     in:  { x, z }  inside the lobby, in the dark: where a person is gone }
 *
 * (x, z) is the middle of the sliding doors; (nx, nz) points out of the
 * building. An air base's operations block and a flying club have none:
 * nobody cycles in and out of them.
 */
export function terminalDoors(lay) {
  const T = lay && lay.terminal;
  if (!T || !T.rect || lay.military || lay.shape === 'strip') return [];
  const F = lay.frame;
  const out = [];
  const add = (side, u, stand) => {
    const D = DOOR[side];
    const w = side === 'air' ? T.front - D.depth : T.back + D.depth;
    const sign = side === 'air' ? -1 : 1;
    out.push({
      id: out.length,
      side,
      stand,
      u,
      x: F.x(u),
      z: F.z(w),
      nx: 0,
      nz: sign * F.side,
      hw: D.hw,
      h: D.h,
      out: { x: F.x(u), z: F.z(w + sign * 3.5) },
      in: { x: F.x(u), z: F.z(side === 'air' ? T.front - 0.6 : T.back + 0.5) },
    });
  };
  // At the foot of each jet bridge, past its rotunda; the same along the wall at a stand without one.
  const taken = [];
  for (const st of lay.stands || []) {
    const u = st.u + lay.side * ((st.size === 'heavy' ? 16 : 9) + DOOR_PAST_ROTUNDA);
    if (u < T.u0 + 6 || u > T.u1 - 6) continue;
    if (taken.some((q) => Math.abs(q - u) < 12)) continue;
    taken.push(u);
    add('air', u, st.id ?? st.number ?? null);
  }
  // Two entrances under the canopy, a third of the way in from each end, each with two sets of doors.
  const W = T.u1 - T.u0;
  const mid = (T.u0 + T.u1) / 2;
  for (const ou of ENTRANCES_U(W)) for (const s of [-1, 1]) add('land', mid + ou + s * ENTRANCE_DOORS, null);
  return out;
}

/** Each entrance's centre from the terminal's middle. */
export const ENTRANCES_U = (W) => [-W / 6, W / 6];
/** Each set of sliding doors from its entrance's centre. */
export const ENTRANCE_DOORS = 3.6;

/**
 * The ways in, as real doors (the owner: "why do people magically appear
 * from outside the airport? and head into. wall"):
 *
 *   THE KERB   two entrances under the canopy, each a glazed lobby built out
 *              of the wall with two sets of sliding doors
 *   THE APRON  a small lobby at the foot of each jet bridge, where the walk
 *              across the apron comes in, its door number over it
 *
 * Each lobby is a real hollow box, black inside: the hall's walls are one
 * solid mesh, so the way in is built OUT of the wall. A person walks in
 * through the open doors and goes dark in there (life/people.js `dim`), and
 * the doors shut behind them. World-life and the turnaround ask for a door
 * (wantDoor); the leaves slide in stepDoors(). One InstancedMesh for all of them.
 *
 * Not in world/apron.js: that is in the first-load budget, and nothing here is
 * needed before a flight starts.
 */
export function dressDoors(ap) {
  const lay = ap.lay;
  const T = lay.terminal;
  const F = lay.frame;
  const vc = new Batch();
  // The black lining, its own mesh: the walk-in (features/terminal) takes it away and the lobby opens into the hall.
  const dark = new Batch();
  const WHITE = 0xe8ecef;
  const STEEL = 0x8d949c;
  const DARK = 0x07090b;
  const GLASS = 0x2a3a46;
  const doors = terminalDoors(lay).map((d) => ({ ...d, open: 0, want: 0 }));
  if (!doors.length) return null;
  const ELEV = AIRPORT.elev;
  const zFront = F.z(T.front);
  const zBack = F.z(T.back);
  const box = (w, h, d, x, y, z, c) => vc.box(w, h, d, x, ELEV + y, z, c);
  /* A lobby: `w` wide, `h` tall, `D` out from wall plane z0 along n (sign), at x. Black inside. */
  const lobby = (x, z0, n, w, h, D, frame) => {
    const zm = z0 + (n * D) / 2;
    // Roof, floor and the two sides; the back is the wall, lined black.
    box(w + 0.7, 0.32, D + 0.5, x, h + 0.42, z0 + (n * (D + 0.5)) / 2, frame);
    box(w + 0.1, 0.05, D, x, 0.03, zm, 0x30343a);
    for (const s of [-1, 1]) {
      box(0.22, h + 0.3, D, x + s * (w / 2 + 0.11), (h + 0.3) / 2, zm, frame);
      dark.box(0.02, h + 0.3, D - 0.04, x + s * (w / 2 - 0.01), ELEV + (h + 0.3) / 2, zm, DARK);
    }
    dark.box(w, h + 0.3, 0.06, x, ELEV + (h + 0.3) / 2, z0 + n * 0.08, DARK);
    dark.box(w, 0.04, D - 0.06, x, ELEV + h + 0.24, zm, DARK);
    // Over the doors, a lintel the height of the frame.
    box(w + 0.1, 0.34, 0.2, x, h + 0.13, z0 + n * (D - 0.1), frame);
  };
  const n = Math.sign(zFront - zBack);
  for (const d of doors) {
    if (d.side !== 'air') continue;
    const Dm = DOOR.air;
    const w = Dm.wide * 2;
    lobby(d.x, zFront, n, w, Dm.h, Dm.depth, WHITE);
    // A fixed sidelight each side of the doors, that the leaves slide across.
    for (const s of [-1, 1]) box(w / 4 - 0.02, Dm.h, 0.06, d.x + s * (w / 2 - w / 8), Dm.h / 2, d.z - n * 0.09, GLASS);
  }
  const Dm = DOOR.land;
  for (const ou of ENTRANCES_U(T.u1 - T.u0)) {
    const c = F.x((T.u0 + T.u1) / 2 + ou);
    const w = Dm.wide * 2 + 0.6;
    lobby(c, zBack, -n, w, Dm.h + 0.4, Dm.depth, WHITE);
    const zF = zBack - n * (Dm.depth - 0.09);
    // White piers, and glass either side of each set of doors and over them.
    for (const ox of [-(w / 2) + 0.2, 0, w / 2 - 0.2]) box(0.5, Dm.h + 0.4, 0.3, c + ox, (Dm.h + 0.4) / 2, zF, WHITE);
    for (const ox of [-ENTRANCE_DOORS, ENTRANCE_DOORS]) for (const s of [-1, 1]) box(1.8, Dm.h, 0.06, c + ox + s * 2.5, Dm.h / 2, zF, GLASS);
    box(w - 0.2, 0.4, 0.06, c, Dm.h + 0.2, zF, GLASS);
  }
  // The sliding leaves, two to a door.
  const leaf = new Batch();
  leaf.box(1, 1, 1, 0, 0, 0, GLASS);
  leaf.box(1.02, 0.06, 1.2, 0, 0.47, 0, STEEL);
  leaf.box(1.02, 0.06, 1.2, 0, -0.47, 0, STEEL);
  leaf.box(0.05, 1.0, 1.2, 0.485, 0, 0, STEEL);
  leaf.box(0.05, 1.0, 1.2, -0.485, 0, 0, STEEL);
  const g = leaf.geometry();
  const mat = vcMaterial({ roughness: 0.25, metalness: 0.4 });
  const shell = vc.mesh(vcMaterial({ roughness: 0.75, metalness: 0.1 }), { name: 'terminal-door-lobbies' });
  if (shell) ap.group.add(shell);
  const lining = dark.mesh(vcMaterial({ roughness: 0.9 }), { cast: false, name: 'terminal-door-lining' });
  if (lining) ap.group.add(lining);
  const mesh = new THREE.InstancedMesh(g, mat, doors.length * 2);
  mesh.name = 'terminal-door-leaves';
  mesh.castShadow = false;
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  ap.group.add(mesh);
  const pose = (i) => {
    const d = doors[i];
    const slide = d.hw * 0.96 * d.open;
    for (let k = 0; k < 2; k++) {
      const s = k ? 1 : -1;
      _m.compose(_p.set(d.x + s * (d.hw / 2 + slide), ELEV + d.h / 2, d.z + d.nz * 0.03), _q, _s.set(d.hw, d.h, 0.07));
      mesh.setMatrixAt(i * 2 + k, _m);
    }
  };
  for (let i = 0; i < doors.length; i++) pose(i);
  mesh.instanceMatrix.needsUpdate = true;
  // The leaves slide a metre or two: the sphere round them shut, and a little, holds them open.
  mesh.computeBoundingSphere();
  mesh.boundingSphere.radius += 4;
  ap.doors = doors;
  /** Somebody is at door `i`: it opens, and stays open a moment. */
  ap.wantDoor = (i) => {
    if (doors[i]) doors[i].want = 1.2;
  };
  /** The nearest door to (x, z), of one side or either; null if there is none. */
  ap.nearestDoor = (x, z, side = null) => {
    let best = null;
    let bd = Infinity;
    for (const d of doors) {
      if (side && d.side !== side) continue;
      const q = Math.hypot(d.x - x, d.z - z);
      if (q < bd) {
        bd = q;
        best = d;
      }
    }
    return best;
  };
  ap.stepDoors = (dt) => {
    let moved = false;
    for (let i = 0; i < doors.length; i++) {
      const d = doors[i];
      d.want = Math.max(0, d.want - dt);
      const target = d.want > 0 ? 1 : 0;
      if (d.open === target) continue;
      d.open = target > d.open ? Math.min(1, d.open + dt * 1.6) : Math.max(0, d.open - dt * 1.2);
      pose(i);
      moved = true;
    }
    if (moved) mesh.instanceMatrix.needsUpdate = true;
  };
  return mesh;
}

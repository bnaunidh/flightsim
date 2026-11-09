/**
 * The far fields, up close: what stops an airport you did not start from being
 * a few boxes. Land at one and it should look used.
 *
 *   curtain wall   the same glazing as the main terminal (world/terminal-look.js),
 *                  lit rooms and all, one quad a face in one shared material,
 *                  above Low
 *   small details  fins, doors, a kerb with bollards, benches and lamps, apron
 *                  stairs, ground power, baggage carts, cones, a fire engine:
 *                  one InstancedMesh of one unit box, a matrix and a colour each,
 *                  so a field's thousand small things are one draw call and a
 *                  twentieth of the memory of baking them in. Hidden past
 *                  DETAIL_RANGE, none at all on Low.
 *
 * Not in the first load: the World Map's fields only.
 */
import * as THREE from '../../vendor/three.module.js';
import { Batch, trs, layer } from '../airport-kit.js';
import { glassMaterial } from '../../render/surfaces.js';
import { glazingTextures, TILE_W_M, TILE_H_M } from '../terminal-look.js';

/** Metres from a field at which its small things are still drawn. */
export const DETAIL_RANGE = Object.freeze({ low: 0, medium: 3000, high: 5000, ultra: 8000 });

const WHITE = 0xe8ecef;
const STEEL = 0x8d949c;
const DARK = 0x20262c;
const HI = 0xf3a01c;

const UNIT = new THREE.BoxGeometry(1, 1, 1);
UNIT.userData.shared = true;
let unitMat = null;
const _m = new THREE.Matrix4();
const _c = new THREE.Color();

export class Detail {
  constructor() {
    this.a = [];
  }

  get count() {
    return this.a.length;
  }

  box(w, h, d, x, y, z, hex, ry = 0) {
    this.a.push([w, h, d, x, y, z, hex, ry]);
  }

  /** One mesh, or null if there is nothing in it. */
  mesh() {
    const n = this.a.length;
    if (!n) return null;
    if (!unitMat) {
      unitMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
      unitMat.userData.shared = true;
      layer(unitMat, 'runway'); // over the field batch's own pavement pull
    }
    const m = new THREE.InstancedMesh(UNIT, unitMat, n);
    m.name = 'field-detail';
    this.a.forEach(([w, h, d, x, y, z, hex, ry], i) => {
      m.setMatrixAt(i, trs(x, y, z, ry, w, h, d, _m));
      m.setColorAt(i, _c.set(hex));
    });
    m.instanceMatrix.needsUpdate = true;
    m.instanceColor.needsUpdate = true;
    m.computeBoundingSphere();
    m.castShadow = false;
    m.receiveShadow = false;
    this.a = [];
    return m;
  }
}

/** Curtain wall, one quad a face: dark tinted glass, and the rooms behind it after dark. */
let glassMat = null;
function fieldGlassMaterial() {
  if (glassMat) return glassMat;
  const t = glazingTextures(false);
  glassMat = glassMaterial({ map: t.day, emissiveMap: t.night, roughness: 0.14, metalness: 0.55 });
  glassMat.emissive = new THREE.Color(0xffffff);
  glassMat.emissiveIntensity = 0;
  glassMat.userData.shared = true;
  layer(glassMat, 'runway');
  return glassMat;
}

/** How lit the far terminals are: 0 by day. */
export function setFieldGlow(k) {
  if (glassMat) glassMat.emissiveIntensity = k;
}

export class Glazing {
  constructor() {
    this.b = new Batch();
  }

  /** `len` by `h` at centre (x, y, z), looking along `ry`. */
  pane(len, h, x, y, z, ry) {
    const g = new THREE.PlaneGeometry(len, h);
    const uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) * len) / TILE_W_M, (uv.getY(i) * h) / TILE_H_M);
    this.b.add(g, trs(x, y, z, ry), 0xffffff);
    g.dispose();
  }

  mesh() {
    if (!this.b.vertexCount) return null;
    const m = this.b.mesh(fieldGlassMaterial(), { cast: false, receive: false, name: 'field-glass' });
    if (m) m.geometry.deleteAttribute('color');
    return m;
  }
}

const GLAZED = new Set(['glass', 'hall', 'block']);

/** Doors, glass, fins and a working kerb on a terminal `s` (airside z1, kerb z0). */
export function dressTerminal(D, G, s, st) {
  const W = s.x1 - s.x0;
  const cx = (s.x0 + s.x1) / 2;
  const h = s.h;
  const glazed = GLAZED.has(st.terminal);
  const low = !glazed && st.terminal !== 'modules';
  if (glazed && G) {
    // Two storeys of the real curtain wall, airside and to the kerb, over the style's own walls.
    const gh = Math.min(h * 0.72, 12);
    const y = 1.6 + gh / 2;
    G.pane(W * 0.97, gh, cx, y, s.z1 + 0.62, 0);
    G.pane(W * 0.97, gh * 0.55, cx, 1.6 + gh * 0.55 * 0.5 + 2.2, s.z0 - 0.42, Math.PI);
  }
  if (D && glazed) {
    const gh = Math.min(h * 0.72, 12);
    for (let x = s.x0 + 6; x < s.x1 - 3; x += 6) D.box(0.26, gh, 0.6, x, 1.6 + gh / 2, s.z1 + 0.95, STEEL);
    D.box(W * 0.97, 0.4, 0.5, cx, 1.6 + gh / 2, s.z1 + 0.9, 0xd3d8dc);
    // ...and lighter along the kerb, over the pane there.
    for (let x = s.x0 + 6; x < s.x1 - 3; x += 12) D.box(0.2, gh * 0.55, 0.3, x, 3.8 + gh * 0.275, s.z0 - 0.6, STEEL);
  }
  if (!D) return;
  // Airside: a door every so often, with a light over it.
  for (let x = s.x0 + 14; x < s.x1 - 8; x += 44) {
    D.box(3, 2.6, 0.3, x, 1.3, s.z1 + 0.85, DARK);
    D.box(3.4, 0.22, 0.5, x, 2.72, s.z1 + 0.85, WHITE);
  }
  // The kerb: a pavement, bollards, the way in under a canopy, benches and lamps.
  const zk = s.z0 - 1;
  D.box(W * 0.9, 0.16, 6, cx, 0.08, zk - 3, 0xb9b7ae);
  D.box(W * 0.9, 0.2, 0.3, cx, 0.1, zk - 6, 0xd4d2c8);
  const can = Math.min(W * 0.7, 130);
  if (W >= 50) {
    D.box(can, 0.36, 5, cx, 4.6, zk - 2, low ? 0x8a8d90 : WHITE);
    for (let x = cx - can / 2 + 3; x <= cx + can / 2 - 3; x += 12) D.box(0.34, 4.5, 0.34, x, 2.25, zk - 4.2, STEEL);
  }
  for (const k of W >= 50 ? [-0.18, 0.18] : [0]) {
    const x = cx + k * W;
    D.box(6.4, 3, 0.4, x, 1.5, s.z0 - 0.3, DARK);
    D.box(7, 0.34, 0.6, x, 3.14, s.z0 - 0.3, WHITE);
    D.box(0.12, 3, 0.5, x, 1.5, s.z0 - 0.32, STEEL);
  }
  for (let x = s.x0 + 10; x < s.x1 - 8; x += 5.5) D.box(0.16, 0.92, 0.16, x, 0.46, zk - 5.6, 0x3c4148);
  for (let x = s.x0 + 18, i = 0; x < s.x1 - 14; x += 26, i++) {
    D.box(2.2, 0.1, 0.5, x, 0.5, zk - 1.2, 0x8a6a48);
    D.box(2.2, 0.5, 0.08, x, 0.74, zk - 0.98, 0x8a6a48);
    D.box(0.5, 0.9, 0.5, x + 3, 0.45, zk - 1.2, 0x4c5660);
    D.box(0.16, 7, 0.16, x + 8, 3.5, zk - 5, 0x5a6068);
    D.box(1.5, 0.14, 0.3, x + 8, 7, zk - 5, 0x5a6068);
    if (i % 3 === 0) {
      // A bus shelter: a roof, a back and a timetable.
      D.box(4, 0.12, 1.7, x + 13, 2.5, zk - 7.4, 0x5a6068);
      D.box(4, 2.3, 0.06, x + 13, 1.2, zk - 6.6, 0x8fb0c0);
      D.box(0.1, 2.5, 0.1, x + 11.2, 1.25, zk - 8, 0x5a6068);
    }
  }
  // Three flags at the entrance: plain colours, nobody's.
  for (const [i, c] of [[-1, 0x2a6f97], [0, 0xd9a02e], [1, 0xb7372a]]) {
    D.box(0.12, 9, 0.12, cx + i * 3, 4.5, zk - 7, 0xd5d8da);
    D.box(1.8, 1.1, 0.05, cx + i * 3 + 0.96, 8.3, zk - 7, c);
  }
  // Plant on a flat roof.
  if (glazed) for (let x = s.x0 + 16; x < s.x1 - 14; x += 38) D.box(5, 1.8, 3.4, x, h + 1.1, (s.z0 + s.z1) / 2, 0x8d949c);
}

/**
 * A parked airliner's ground kit: apron stairs at the front door, stairs aft at
 * a turboprop, ground power, a baggage train, cones. Nose to -z at (x, z).
 */
export function dressStand(D, x, z, L, S, turbo, stairs) {
  if (!D) return;
  const r = L * 0.055;
  // Left-hand door: stairs from the apron at the door's sill, on a little truck.
  const door = z - L * 0.28;
  const sill = turbo ? 1.5 : r + 1.6 + r * 0.25;
  if (stairs) {
    const sx = x - r - 1.4;
    const n = Math.max(4, Math.round(sill / 0.26));
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n;
      D.box(1.4 * 1 + 0.9 * (1 - t) * 3.2, 0.1, 1.5, sx - 0.72 - 3.2 * (1 - t) * 0.9, sill * t, door, WHITE);
    }
    D.box(3.8, 0.9, 1.9, sx - 2.2, 0.55, door, 0xd9a02e);
    D.box(1.6, 1.0, 1.6, sx - 4.6, 1.5, door, 0xd9a02e);
    for (const dz of [-0.75, 0.75]) D.box(4.2, 0.08, 0.06, sx - 1.9, sill * 0.55 + 0.95, door + dz, STEEL);
  }
  // Ground power and its cable, and a tug.
  D.box(1.3, 1.1, 1.1, x + r + 5, 0.55, z - L * 0.36, 0xe0e2e2);
  D.box(0.1, 0.06, 4.6, x + r + 2.6, 0.03, z - L * 0.36, 0x16181a);
  // A baggage train aft of the wing, a belt to the hold.
  D.box(1.5, 0.9, 2.6, x + r + 4.2, 0.6, z + L * 0.18, HI);
  for (let i = 0; i < 3; i++) {
    D.box(1.4, 0.5, 2.1, x + r + 4.2, 0.45, z + L * 0.18 + 3.1 + i * 2.6, 0x4a5462);
    D.box(1.3, 0.9, 1.9, x + r + 4.2, 1.08, z + L * 0.18 + 3.1 + i * 2.6, 0x2f6fbd);
  }
  // Cones at the nose and each wingtip.
  for (const [cx0, cz0] of [[x, z - L * 0.56], [x - S / 2 - 1, z + L * 0.06], [x + S / 2 + 1, z + L * 0.06]]) D.box(0.3, 0.55, 0.3, cx0, 0.28, cz0, 0xf06a1a);
  // The stand's lead-in and stop bar.
  D.box(0.22, 0.015, L * 1.3, x, 0.075, z, 0xd9c02a);
  D.box(4, 0.015, 0.3, x, 0.075, z - L * 0.46, 0xeeeeea);
}

/** The fire station's engine out in front and its drying tower. */
export function dressFire(D, s) {
  if (!D) return;
  const x = (s.x0 + s.x1) / 2;
  const z = s.z1 + 6;
  D.box(2.5, 1.6, 8, x, 1.3, z, 0xb8322a);
  D.box(2.5, 1.1, 2.4, x, 2.3, z - 2.6, 0xb8322a);
  D.box(2.2, 0.8, 0.1, x, 2.4, z - 3.85, 0x2a3640);
  D.box(0.4, 0.5, 0.8, x, 3.1, z - 2.4, 0xe0a428);
  for (const dz of [-2.6, 2.4]) for (const dx of [-1.2, 1.2]) D.box(0.36, 1, 1, x + dx, 0.5, z + dz, 0x16181a);
}

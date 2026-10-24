/**
 * The Boeing C-17 Globemaster III, drawn at full size — built the way
 * ./giants.js builds the C-5: the airliner kit's lofted fuselage in plain
 * military grey, framed flight-deck glazing, doors that open, four
 * turbofans on pylons under a high wing, real undercarriage — from
 * C17_GEOMETRY (../../aircraft/extra/c17.js), the same metres the flight
 * model flies.
 *
 * WHAT MAKES IT ITSELF, from 300 m and from the ramp:
 *
 *   - a short blunt nose with the windscreen high on it, the flight deck
 *     over the front of the hold;
 *   - a deep square-shouldered body with the gear SPONSONS bulging out of
 *     its lower sides, three axle pairs in each;
 *   - the wing on the crown in a long fairing, swept 25 degrees, with four
 *     big fans hung well ahead of and below the leading edge, and tall
 *     WINGLETS;
 *   - a T-tail;
 *   - the belly swept up behind the wheels for the RAMP, which comes down
 *     to the ground on a hinge at the end of the cargo floor, with the
 *     cargo door above it swinging up inside — and behind them a HOLD you
 *     can see into: the floor with its roller rails, ribs along the walls,
 *     lights in the ceiling and a pair of pallets strapped down.
 *
 * THE OPENING IS CUT OUT OF THE SKIN. The kit lofts the fuselage as one
 * closed hull, so the ramp and the cargo door are made from the same
 * surface (skinPatch, the way the doors are) and the triangles of the loft
 * under them are removed. The cut is by the hull's own angle coordinate
 * (hull.angleAt), so the opening's side edges are at a fixed angle round
 * the section — about a metre above the floor at the hinge — and a
 * darker FRAME band round the edge hides the staircase that cutting whole
 * triangles leaves. Inside, a second, smaller loft of the aft fuselage with
 * its faces turned inward is the hold's roof and walls where the body
 * narrows, so looking in through the ramp never looks out through the sky.
 *
 * userData.cargo is the API: open() / close() / toggle() / set(t) /
 * amount() / isOpen / state. src/features/cargo-ramp.js drives it from a
 * key, a panel and a touch button, on the ground or under 150 kt.
 *
 * No service markings: this game names no air force.
 */

import * as THREE from '../../vendor/three.module.js';
import { C17_GEOMETRY, C17_RAMP as RAMP } from '../../aircraft/extra/c17.js';
import {
  dressAirliner as dress, refitAirlinerLeg as refitLeg, bodyOf, plate, wingAt, trailingEdgeFill, findByName,
} from './airliners.js';
import { axleY, enginesOf, specOf, dorsalFairing, removeNamed } from './jets.js';
import { meshOf, piecewise, mergeGeometries, DECAL } from './airliner-kit.js';
import { skinPatch } from '../../aircraft/models/airliner-parts.js';
import { hull } from '../../aircraft/models/civil-kit.js';

const clamp = THREE.MathUtils.clamp;
const mix = (a, b, t) => a + (b - a) * t;
const st = (z, top, bot, w, yc, nT = 2, nB = 2) => ({ z, top, bot, w, yc: yc ?? (top + bot) / 2, nT, nB });

/* ------------------------------------------------------------------ *
 * Undercarriage
 * ------------------------------------------------------------------ */

/**
 * A row of axles in a sponson (the giants' podRow): the core's main leg
 * refitted with a bogie of `axles` pairs whose REAR axle sits on the
 * physics contact point, so the row runs forward from it — rigid, not
 * levelled: rotating on the back wheels lifts the front ones, as it should.
 */
function podRow(ctx, legId, { axles, pitch, track, r, width, oleo, mats }) {
  const b = refitLeg(ctx, legId, { kind: 'bogie', axles, pitch, track, r, width, oleo, mats });
  if (!b) return null;
  // In a sponson there is no leg door: the sponson is the fairing.
  removeNamed(ctx.parts[legId], 'Gear leg door');
  const shift = ((axles - 1) * pitch) / 2;
  b.position.z -= shift;
  for (let i = 1; i < axles; i += 2) {
    const z = shift - i * pitch;
    ctx.tube('Pod strut', [0, r * 0.2, z], [0, r * 0.2 + 1.4, z + 0.2], oleo * 0.8, mats.gear, b, 8);
  }
  return b;
}

/**
 * The gear sponsons: a closed loft each side of the lower fuselage, half
 * buried in it, from ahead of the wing to where the belly starts to rise.
 * Stations are in the sponson's own frame (its centreline at x = 0).
 */
function sponsons(ctx, mat) {
  const stations = [
    st(-6.5, -1.3, -3.0, 0.05, -2.15, 2.2, 2.0),
    st(-5.4, -1.0, -3.4, 0.6, -2.2, 2.2, 2.0),
    st(-3.8, -0.8, -3.55, 0.95, -2.2, 2.2, 2.0),
    st(6.0, -0.8, -3.55, 0.95, -2.2, 2.2, 2.0),
    st(8.0, -0.95, -3.4, 0.7, -2.2, 2.2, 2.0),
    st(9.3, -1.3, -3.0, 0.1, -2.15, 2.2, 2.0),
  ];
  for (const side of [-1, 1]) {
    const h = hull({ stations, radial: 8, maxStep: 2.5, closeTail: true, uvBand: 0.5 });
    h.geometry.translate(side * 3.9, 0, 0);
    meshOf(ctx, 'Gear sponson', h.geometry, mat, ctx.parts.fuselage);
  }
}

/* ------------------------------------------------------------------ *
 * The hold and the ramp
 * ------------------------------------------------------------------ */

/**
 * Remove every triangle of an indexed hull geometry that lies in the
 * opening: all three vertices between z0 and z1 (rings of the hull, so
 * nothing straddles them) and any vertex further round the section than
 * `s0` (so no sliver of skin hangs into the hole; the gap this leaves
 * above the edge is under the frame band). `angleOf(z, y)` is the hull's
 * own angleAt.
 */
export function cutOpening(geo, angleOf, { z0, z1, s0 }) {
  const pos = geo.attributes.position;
  const idx = geo.index;
  const keep = [];
  const n = idx.count / 3;
  let removed = 0;
  for (let t = 0; t < n; t++) {
    let inZ = true;
    let deep = false;
    for (let k = 0; k < 3; k++) {
      const v = idx.getX(t * 3 + k);
      const z = pos.getZ(v);
      if (z < z0 - 1e-3 || z > z1 + 1e-3) inZ = false;
      if (angleOf(z, pos.getY(v)) > s0 + 0.01) deep = true;
    }
    if (inZ && deep) {
      removed++;
      continue;
    }
    keep.push(idx.getX(t * 3), idx.getX(t * 3 + 1), idx.getX(t * 3 + 2));
  }
  const out = new THREE.BufferGeometry();
  for (const name of Object.keys(geo.attributes)) out.setAttribute(name, geo.attributes[name]);
  out.setIndex(keep);
  out.userData.removed = removed;
  return out;
}

/** Turn every face of an indexed geometry round, so it is seen from inside. */
function inward(geo) {
  const idx = geo.index;
  for (let t = 0; t < idx.count; t += 3) {
    const b = idx.getX(t + 1);
    idx.setX(t + 1, idx.getX(t + 2));
    idx.setX(t + 2, b);
  }
  const nrm = geo.attributes.normal;
  if (nrm) for (let i = 0; i < nrm.count; i++) nrm.setXYZ(i, -nrm.getX(i), -nrm.getY(i), -nrm.getZ(i));
  return geo;
}

/** A piece of the skin from z0 to z1 between the angles s0 and s1, both sides, as one geometry. */
function skinBand(h, { z0, z1, s0, s1 }, off, uvOf, nu = 4, nv = 5) {
  const quad = [[z0, s0], [z1, s0], [z1, s1], [z0, s1]];
  return mergeGeometries([skinPatch(h, quad, 1, off, nu, nv, uvOf), skinPatch(h, quad, -1, off, nu, nv, uvOf)]);
}

/** The cargo floor: dark non-slip panels with two roller rails and tie-down rings down each side. */
let floorTex = null;
function cargoFloorTexture() {
  if (floorTex) return floorTex;
  const W = 256;
  const H = 1024;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d');
  g.fillStyle = '#3f464c';
  g.fillRect(0, 0, W, H);
  // Panel joints across.
  g.strokeStyle = 'rgba(0,0,0,0.35)';
  g.lineWidth = 2;
  for (let y = 0; y < H; y += 64) {
    g.beginPath();
    g.moveTo(0, y);
    g.lineTo(W, y);
    g.stroke();
  }
  // Roller rails: two pairs, with the rollers as light dashes.
  for (const x of [W * 0.3, W * 0.7]) {
    g.fillStyle = '#2a2f34';
    g.fillRect(x - 11, 0, 22, H);
    g.fillStyle = '#9aa3aa';
    for (let y = 6; y < H; y += 20) g.fillRect(x - 7, y, 14, 8);
  }
  // Tie-down rings along the edges.
  g.strokeStyle = '#c4cbd1';
  g.lineWidth = 3;
  for (let y = 24; y < H; y += 96) {
    for (const x of [W * 0.08, W * 0.92]) {
      g.beginPath();
      g.arc(x, y, 6, 0, Math.PI * 2);
      g.stroke();
    }
  }
  floorTex = new THREE.CanvasTexture(c);
  floorTex.colorSpace = THREE.SRGBColorSpace;
  floorTex.anisotropy = 4;
  floorTex.name = 'c17-cargo-floor';
  return floorTex;
}

/**
 * Cut the opening, line the aft body, furnish the hold, hang the ramp and
 * the cargo door, and hand back the API that moves them.
 */
function cargoHold(ctx, h, M, along, F) {
  const { model, parts } = ctx;
  const own = (g) => model.userData.ownGeometry(g);
  const ownM = (m) => model.userData.ownMaterial(m);
  const R = RAMP;
  const edge = R.edgeS;
  const ground = C17_GEOMETRY.c17.ground;

  // 1. The hole, out of the tail cone's skin (the cut at the hinge puts the
  //    whole opening in that piece).
  const skin = findByName(parts.tail, 'Tail cone skin');
  let removed = 0;
  if (skin) {
    const cut = cutOpening(skin.geometry, (z, y) => h.angleAt(z, y), { z0: R.hingeZ, z1: R.doorEnd, s0: edge });
    removed = cut.userData.removed;
    skin.geometry = own(cut);
  }

  // 2. Materials of the inside.
  const holdMat = ownM(new THREE.MeshStandardMaterial({ name: 'C17_hold', color: 0x4d555c, metalness: 0.15, roughness: 0.85 }));
  const linerMat = ownM(new THREE.MeshStandardMaterial({ name: 'C17_liner', color: 0x454c53, metalness: 0.1, roughness: 0.9 }));
  const frameMat = ownM(new THREE.MeshStandardMaterial({ name: 'C17_door_frame', color: 0x3a4046, metalness: 0.3, roughness: 0.7, ...DECAL }));
  const lampMat = ownM(new THREE.MeshBasicMaterial({ name: 'C17_hold_lights', color: 0xe6eef4 }));
  const palletMat = ownM(new THREE.MeshStandardMaterial({ name: 'C17_pallet', color: 0x5a5f48, metalness: 0.05, roughness: 0.9 }));
  const floorMat = ownM(new THREE.MeshStandardMaterial({ name: 'C17_cargo_floor', map: cargoFloorTexture(), metalness: 0.3, roughness: 0.75 }));
  // The ramp's and the door's own skin: the livery, a hair proud of the hull
  // with the decal offset, so the edge never fights the skin it meets.
  const rampSkin = ownM(Object.assign(M.skin.clone(), DECAL, { name: 'C17_ramp_skin' }));

  // 3. The liner: the aft body again, 14 cm in, faces inward, with the same
  //    opening cut out of it.
  {
    const inner = F.stations.filter((s) => s.z >= R.hingeZ - 1.8).map((s) => st(s.z, s.top - 0.14, s.bot + 0.14, Math.max(0.02, s.w - 0.14), s.yc, s.nT, s.nB));
    const lh = hull({ stations: inner, radial: 12, maxStep: 8, rings: [R.hingeZ, R.rampEnd, R.doorEnd], closeTail: false, uvBand: 0.5 });
    const cut = cutOpening(lh.geometry, (z, y) => lh.angleAt(z, y), { z0: R.hingeZ, z1: R.doorEnd, s0: edge });
    meshOf(ctx, 'Hold liner', inward(cut), linerMat, parts.tail).castShadow = false;
  }

  // 4. The hold: floor, walls, roof, the forward bulkhead, ribs, lights, two pallets.
  {
    const W = R.holdWidth;
    const Hh = R.holdHeight;
    const z0 = R.holdFront;
    const z1 = R.hingeZ;
    const L = z1 - z0;
    const zc = (z0 + z1) / 2;
    const yc = R.floorY + Hh / 2;
    ctx.box('Hold floor', [W, 0.16, L], [0, R.floorY - 0.08, zc], holdMat, parts.fuselage);
    ctx.box('Hold wall', [0.12, Hh, L], [-W / 2, yc, zc], holdMat, parts.fuselage);
    ctx.box('Hold wall', [0.12, Hh, L], [W / 2, yc, zc], holdMat, parts.fuselage);
    ctx.box('Hold roof', [W, 0.12, L], [0, R.floorY + Hh, zc], holdMat, parts.fuselage);
    ctx.box('Hold bulkhead', [W, Hh, 0.12], [0, yc, z0], holdMat, parts.fuselage);
    for (let z = z0 + 2.0; z < z1 - 0.5; z += 3.5) {
      for (const s of [-1, 1]) ctx.box('Hold rib', [0.1, Hh - 0.2, 0.28], [s * (W / 2 - 0.1), yc, z], holdMat, parts.fuselage);
    }
    const floor = new THREE.PlaneGeometry(W - 0.3, L);
    floor.rotateX(-Math.PI / 2);
    floor.translate(0, R.floorY + 0.012, zc);
    meshOf(ctx, 'Cargo floor', floor, floorMat, parts.fuselage).castShadow = false;
    for (const s of [-1, 1]) ctx.box('Hold light', [0.14, 0.05, L - 1.0], [s * 1.6, R.floorY + Hh - 0.08, zc], lampMat, parts.fuselage).castShadow = false;
    // Two pallets on the rollers, netted down.
    ctx.box('Cargo pallet', [2.2, 1.9, 2.7], [0, R.floorY + 0.95, -7.0], palletMat, parts.fuselage);
    ctx.box('Cargo pallet', [2.2, 1.6, 2.7], [0, R.floorY + 0.8, -2.4], palletMat, parts.fuselage);
  }

  // 5. The frame round the opening, over the cut edge.
  {
    const band = skinBand(h, { z0: R.hingeZ, z1: R.doorEnd, s0: edge - 0.25, s1: edge }, 0.012, null, 6, 2);
    meshOf(ctx, 'Ramp door frame', band, frameMat, parts.tail).castShadow = false;
  }

  // 6. The ramp, hinged at the end of the floor.
  const uvOf = (z, s) => [along(z), 1 - s / Math.PI];
  const hinge = new THREE.Vector3(0, R.floorY, R.hingeZ);
  const ramp = new THREE.Group();
  ramp.name = 'Cargo ramp';
  ramp.position.copy(hinge);
  parts.tail.add(ramp);
  const yEnd = h.botAt(R.rampEnd);
  const closedAngle = Math.atan2(yEnd - R.floorY, R.rampEnd - R.hingeZ); // the closed ramp's slope up along the belly
  const hingeHeight = R.floorY - ground;
  const openAngle = Math.asin(clamp(hingeHeight / R.length, 0, 1)); // its toe on the ground
  {
    const outer = skinBand(h, { z0: R.hingeZ, z1: R.rampEnd, s0: edge, s1: Math.PI }, 0.006, uvOf, 4, 6);
    outer.translate(-hinge.x, -hinge.y, -hinge.z);
    const m = meshOf(ctx, 'Ramp skin', outer, rampSkin, ramp);
    m.userData.dynamic = true;
    // The deck: a flat floor on the inside of the curved skin, with a rail
    // down each edge, laid along the closed ramp's slope.
    const deck = new THREE.Group();
    deck.name = 'Ramp deck';
    deck.rotation.x = -closedAngle;
    ramp.add(deck);
    const Lr = R.length;
    ctx.box('Ramp floor', [R.holdWidth - 0.3, 0.16, Lr], [0, 0.1, Lr / 2], holdMat, deck).userData.dynamic = true;
    for (const s of [-1, 1]) ctx.box('Ramp rail', [0.14, 0.24, Lr], [s * (R.holdWidth / 2 - 0.22), 0.26, Lr / 2], holdMat, deck).userData.dynamic = true;
    const plank = new THREE.PlaneGeometry(R.holdWidth - 0.6, Lr);
    plank.rotateX(-Math.PI / 2);
    plank.translate(0, 0.19, Lr / 2);
    const pm = meshOf(ctx, 'Ramp rollers', plank, floorMat, deck);
    pm.castShadow = false;
    pm.userData.dynamic = true;
  }

  // 7. The cargo door above it, hinged where the ramp ends, swinging up inside.
  const doorHinge = new THREE.Vector3(0, yEnd, R.rampEnd);
  const door = new THREE.Group();
  door.name = 'Cargo door';
  door.position.copy(doorHinge);
  parts.tail.add(door);
  {
    const outer = skinBand(h, { z0: R.rampEnd, z1: R.doorEnd, s0: edge, s1: Math.PI }, 0.006, uvOf, 4, 5);
    outer.translate(-doorHinge.x, -doorHinge.y, -doorHinge.z);
    meshOf(ctx, 'Cargo door skin', outer, rampSkin, door).userData.dynamic = true;
    const lining = inward(skinBand(h, { z0: R.rampEnd, z1: R.doorEnd, s0: edge, s1: Math.PI }, -0.1, null, 3, 4));
    lining.translate(-doorHinge.x, -doorHinge.y, -doorHinge.z);
    const lm = meshOf(ctx, 'Cargo door lining', lining, linerMat, door);
    lm.castShadow = false;
    lm.userData.dynamic = true;
  }
  const doorSwing = (120 * Math.PI) / 180;

  // 8. The API, and the animation that follows it.
  let t = 0;
  let target = 0;
  const apply = () => {
    ramp.rotation.x = t * (closedAngle + openAngle);
    door.rotation.x = -t * doorSwing;
  };
  const api = {
    open(o = {}) {
      target = 1;
      if (o.instant) t = 1;
      apply();
    },
    close(o = {}) {
      target = 0;
      if (o.instant) t = 0;
      apply();
    },
    toggle(o = {}) {
      if (target > 0.5) api.close(o);
      else api.open(o);
      return target > 0.5;
    },
    set(v) {
      t = target = clamp(Number(v) || 0, 0, 1);
      apply();
    },
    amount: () => t,
    get isOpen() {
      return t > 0.98;
    },
    get target() {
      return target;
    },
    get state() {
      if (t === target) return t > 0.5 ? 'open' : 'closed';
      return target > t ? 'opening' : 'closing';
    },
    angles: { closed: closedAngle, open: openAngle, door: doorSwing },
    hinge: hinge.toArray(),
    length: R.length,
    removed,
    nodes: { ramp, door },
  };
  ctx.registerAnimation((dt) => {
    if (t === target) return;
    const step = (dt || 0) / R.openSeconds;
    t = target > t ? Math.min(target, t + step) : Math.max(target, t - step);
    apply();
  });
  apply();
  return api;
}

/* ------------------------------------------------------------------ *
 * The aeroplane
 * ------------------------------------------------------------------ */

const G = C17_GEOMETRY.c17;

const C17 = specOf(G, {
  tailStart: 10.8,
  ringStep: 1.6,
  radial: 18,
  // The tail piece begins at the ramp hinge, so the whole opening is in it.
  cuts: [-17.2, RAMP.hingeZ],
  alongNose: 0.12,
  bellyY: -2.4,
  laps: [2.4, -1.6],
  // Military grey: no cheatline, no titling.
  cheat: null,
  reg: { z: 24.0, y: 2.9, w: 3.0 },
  windows: [],
  doors: [
    { id: '#1', z: -17.0, y: -0.9, w: 0.9, h: 1.8, kind: 'passenger', sill: -1.8 },
    // The paratroop doors, just ahead of the ramp.
    { id: 'P#1', z: 9.6, y: -0.9, w: 0.9, h: 1.8, kind: 'passenger', sill: -1.8 },
  ],
  // The belly between the sponsons is flat; a shallow keel only.
  fairing: [[-6.0, 2.6, 0.12, -3.14], [-2.0, 3.0, 0.16, -3.12], [4.0, 3.0, 0.16, -3.12], [8.0, 2.6, 0.1, -3.14]],
  // Belly aerials ahead of the wheels: anything under the swept tail would
  // meet the runway first at rotation.
  aerials: { crown: [-14.0, 6.5, 15.0], belly: [-15.0, -12.5] },
  beaconZ: -13.0,
});
// The ramp's rings, so the opening is cut on the loft's own lines.
C17.fuselage.rings = [
  ...C17.fuselage.rings.filter((z) => [RAMP.hingeZ, RAMP.rampEnd, RAMP.doorEnd].every((r) => Math.abs(z - r) > 0.5)),
  RAMP.rampEnd, RAMP.doorEnd,
];

const c17 = {
  id: 'c17', name: 'Boeing C-17 Globemaster III', kind: 'airliner', massKg: 26000,
  paint: '#6f777f', accent: '#4a5157', registration: 'GM-317', bodySegments: 8,
  body: bodyOf(C17.fuselage.stations),
  wing: {
    rootX: 1.5, span: G.tip.x - 1.5, rootZ: G.wingZ, rootY: 3.6,
    rootChord: 10.6, tipChord: 2.4, sweep: 11.2, dihedral: G.tip.y - 3.6,
    thickness: 1.5, tipThickness: 0.3, flaps: true, struts: false,
  },
  // The T-tail: the tailplane on the fin's tip.
  tail: {
    rootX: 0.5, span: 9.4, rootZ: 24.0, rootY: 12.3,
    rootChord: 4.6, tipChord: 2.2, sweep: 2.4, dihedral: 0.2, thickness: 0.45, tipThickness: 0.18,
  },
  fin: { rootZ: 17.5, rootY: 3.9, height: 8.5, rootChord: 11.0, tipChord: 5.2, sweep: 6.5, thickness: 1.0 },
  canopy: null,
  gear: {
    nose: [0, axleY(G, G.nose.r), G.nose.z], main: [G.main.x, axleY(G, G.main.r), G.main.z],
    noseRadius: G.nose.r, mainRadius: G.main.r,
    noseAttach: [0, -2.4, G.nose.z + 0.2], mainAttach: [G.main.x, -2.6, G.main.z],
    retractable: true, dualMain: false, doors: false,
  },
  engines: enginesOf(G),
  eye: G.eye,
  decorate(ctx) {
    const { M, h } = dress(ctx, C17);
    const along = piecewise(C17.fuselage.alongKnots);
    // The high wing sits in a long fairing on the crown.
    dorsalFairing(ctx, [
      [-10.5, 0.4, 0.1, 4.05], [-8.6, 2.0, 0.45, 4.1], [-5.0, 2.5, 0.55, 4.15],
      [2.5, 2.5, 0.55, 4.15], [5.5, 1.9, 0.4, 4.1], [7.5, 0.4, 0.1, 4.05],
    ], along, M.skin);
    sponsons(ctx, M.skin);
    trailingEdgeFill(ctx, 10.5, 2.4, 0.5);
    // Winglets: tall, canted a little outward, swept with the tip.
    const w = ctx.config.wing;
    const tip = wingAt(w, w.rootX + w.span);
    for (const s of [-1, 1]) {
      const x0 = s * (w.rootX + w.span - 0.05);
      plate(ctx, 'Winglet', [
        [x0, tip.mid + 0.05, tip.le + 0.3], [x0, tip.mid + 0.05, tip.te],
        [s * (G.span / 2), tip.mid + 2.9, tip.te + 0.35], [s * (G.span / 2), tip.mid + 2.9, tip.te - 0.75],
      ], 0.14, M.nacelle, ctx.parts[s < 0 ? 'leftWing' : 'rightWing']);
    }
    // Twin nose wheels; three axle pairs in each sponson, the rear one on the contact point.
    refitLeg(ctx, 'noseGear', { kind: 'dual', track: 0.7, r: G.nose.r, width: 0.36, oleo: 0.17, mats: M });
    for (const id of ['leftGear', 'rightGear']) podRow(ctx, id, { axles: 3, pitch: 1.3, track: 1.0, r: G.main.r, width: 0.46, oleo: 0.22, mats: M });
    // The hold, the ramp and the cargo door.
    ctx.exports.cargo = cargoHold(ctx, h, M, along, C17.fuselage);
  },
  description: 'The C-17: a blunt nose with the flight deck high on it, a deep square-shouldered hold with gear sponsons on its sides, four turbofans hung ahead of a high swept wing with tall winglets, a T-tail, and a rear ramp that comes down to the ground under a cargo door that swings up inside, with the hold visible behind them.',
  inspiration: 'Drawn to the C-17A\'s published dimensions; no service markings — the game names no air force.',
};

export const DEFINITIONS = [c17];
export const DRAWS = ['c17'];

/** For tests: the fuselage, deck and door specification, in metres. */
export const C17_SPECS = { c17: C17 };

/**
 * The parts every airliner shares, built once per model: a lofted fuselage
 * with its livery, the flight-deck glazing, cabin window rows, doors that
 * open, and high-bypass turbofans. Used by ./airliners.js for the A320, the
 * 747 and the A380, by the fleet pack's Meridian (../aircraft-transport.js)
 * and, for the glazing and the doors, by the game's own Meridian
 * (../../aircraft/models/meridian.js).
 *
 * WHY A LOFT OF ITS OWN. The pack lofts every fuselage as three closed
 * cylinders through ellipse stations, one ring per station, with the
 * livery texture mapped once per cylinder. On a 70 m airliner that gave a
 * nose of six rings — a cone with a rounded tip — a cheatline that stopped
 * and restarted at each of the three joints, and the pack's anti-glare patch
 * (painted for a light aeroplane's upper nose) on the crown at the front of
 * every section. The loft here is the civil kit's hull() (superellipse
 * sections, monotone splines, analytic normals), as dense as the shape needs
 * through the nose and two rings along the parallel cabin, cut into the
 * pack's three breakaway sections afterwards so the crash code still has its
 * nose, cabin and tail.
 *
 * ONE UV CONVENTION, so paint and parts line up. u runs nose to tail through
 * `along(z)` (piecewise linear, the nose given more of the texture than its
 * length), v runs belly (0) to roof (1) on both sides. Anything laid on the
 * skin that has to match the paint — a door leaf, the belly fairing — uses
 * the same two numbers.
 *
 * Everything is in metres in the aeroplane's frame: -Z forward, +Y up, +X
 * right (starboard), origin at the centre of gravity. `s` is the hull's
 * angle round the section from the top centreline, positive to starboard.
 */
import * as THREE from '../../vendor/three.module.js';
import { addInstanced } from '../common.js';
import { helicopterReflectionEnvironment } from '../helicopter.js';
import { hull, turned } from '../../aircraft/models/civil-kit.js';
import {
  piecewise, splitByZ, skinPatch, remapUV, glazing, buildDoors, mergeGeometries, orientOutward,
} from '../../aircraft/models/airliner-parts.js';

// The parts that sit on a hull live beside the civil kit (model.js's
// Meridian uses them too); re-exported so the airliners import one module.
export { piecewise, splitByZ, remapUV, glazing, buildDoors, mergeGeometries, orientOutward };

const clamp = THREE.MathUtils.clamp;
const mix = (a, b, t) => a + (b - a) * t;

/* ------------------------------------------------------------------ *
 * Materials
 * ------------------------------------------------------------------ */

const textures = new Map();

/** css colour string of anything THREE.Color takes. */
const css = (c, fallback) => {
  try {
    return '#' + new THREE.Color(c ?? fallback).getHexString();
  } catch (e) {
    return fallback;
  }
};
/** Mix two colours (css), t of the way to b. */
function blend(a, b, t) {
  const A = new THREE.Color(a);
  const B = new THREE.Color(b);
  return '#' + A.lerp(B, t).getHexString();
}
/** Perceived brightness, 0-1. */
function luma(c) {
  const k = new THREE.Color(c);
  return 0.2126 * k.r + 0.7152 * k.g + 0.0722 * k.b;
}

/**
 * The livery, painted for one airframe: along (canvas x) by round (canvas
 * y, roof at the top, belly at the bottom). Cached by type and colours —
 * the shared cache, like the pack's own skins; models do not own it.
 *
 * paint = { base, accent, line, key, width, height, along(z), vAt(z, y),
 *           cheat: { y0, y1, z0, z1 }, doors: [...], extra(ctx, W, H, U, V) }
 */
export function liveryTexture(p) {
  const key = `airliner-livery|${p.key}|${p.base}|${p.accent}|${p.line}`;
  if (textures.has(key)) return textures.get(key);
  const W = p.width || 2048;
  const H = p.height || 512;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const g = canvas.getContext('2d');
  const U = (z) => p.along(z) * W;
  const V = (z, y) => (1 - p.vAt(z, y)) * H; // canvas row of height y at station z
  const base = css(p.base, '#f4f6f8');
  const accent = css(p.accent, '#c4122f');
  const dark = luma(base) < 0.35;
  g.fillStyle = base;
  g.fillRect(0, 0, W, H);
  // A belly a shade greyer than the paint, as most airlines leave it, with
  // a soft edge: from the wing root line down.
  const zMid = p.cabinZ;
  const bellyTop = V(zMid, p.bellyY);
  const grad = g.createLinearGradient(0, bellyTop - H * 0.02, 0, H);
  const belly = blend(base, dark ? '#000000' : '#9aa3ab', dark ? 0.25 : 0.32);
  grad.addColorStop(0, base);
  grad.addColorStop(0.08, belly);
  grad.addColorStop(1, blend(belly, '#6b737b', 0.15));
  g.fillStyle = grad;
  g.fillRect(0, bellyTop - H * 0.02, W, H);
  // Panel seams: frames across, lap joints along. Barely there, but the
  // skin reads as metal rather than plastic close up.
  g.strokeStyle = dark ? 'rgba(255,255,255,0.05)' : 'rgba(20,30,40,0.07)';
  g.lineWidth = 1;
  for (let z = p.z0 + 1.6; z < p.z1 - 0.5; z += 1.6) {
    g.beginPath();
    g.moveTo(U(z), 0);
    g.lineTo(U(z), H);
    g.stroke();
  }
  for (const y of p.laps || []) {
    const r = V(zMid, y);
    g.beginPath();
    g.moveTo(0, r);
    g.lineTo(W, r);
    g.stroke();
  }
  // The cheatline: an accent band below the windows and a fine second line
  // under it, swept up at the front where it starts behind the flight deck
  // and cut off at a slant where the tail cone rises.
  if (p.cheat) {
    const c = p.cheat;
    const t0 = V(zMid, c.y1);
    const t1 = V(zMid, c.y0);
    const sweep = (t1 - t0) * 1.2;
    const x0 = U(c.z0);
    const x1 = U(c.z1);
    g.fillStyle = accent;
    g.beginPath();
    g.moveTo(x0 + sweep, t0);
    g.lineTo(x1, t0);
    g.lineTo(x1 - sweep, t1);
    g.lineTo(x0, t1);
    g.closePath();
    g.fill();
    const l0 = t1 + (t1 - t0) * 0.3;
    const l1 = l0 + Math.max(2, (t1 - t0) * 0.28);
    g.fillStyle = p.line || blend(accent, base, 0.35);
    g.beginPath();
    g.moveTo(x0 + sweep * 1.6, l0);
    g.lineTo(x1 - sweep * 1.3, l0);
    g.lineTo(x1 - sweep * 1.6, l1);
    g.lineTo(x0 + sweep * 1.3, l1);
    g.closePath();
    g.fill();
  }
  // The radome joint, just ahead of the windscreen.
  if (p.radomeZ !== undefined) {
    g.strokeStyle = dark ? 'rgba(255,255,255,0.12)' : 'rgba(20,30,40,0.18)';
    g.lineWidth = 1.5;
    g.beginPath();
    g.moveTo(U(p.radomeZ), 0);
    g.lineTo(U(p.radomeZ), H);
    g.stroke();
  }
  // Doors and exits: a seam round the edge with rounded corners, a small
  // window in a passenger door, a handle recess.
  for (const d of p.doors || []) {
    const zA = d.z - d.w / 2;
    const zB = d.z + d.w / 2;
    const xa = U(zA);
    const xb = U(zB);
    // A door on another loft (the 747's upper deck) brings its own map.
    const Vd = d.vAt ? (zz, yy) => (1 - d.vAt(zz, yy)) * H : V;
    const top = Vd(d.z, d.y + d.h / 2);
    const bot = Vd(d.z, d.y - d.h / 2);
    const rx = Math.min((xb - xa) * 0.3, U(d.z + 0.12) - U(d.z));
    const ry = Math.min(Math.abs(bot - top) * 0.3, Math.abs(Vd(d.z, d.y) - Vd(d.z, d.y - 0.12)));
    g.strokeStyle = dark ? 'rgba(230,236,240,0.4)' : 'rgba(28,36,44,0.62)';
    g.lineWidth = Math.max(1.6, W / 1100);
    roundRect(g, xa, top, xb - xa, bot - top, rx, ry);
    g.stroke();
    if (d.kind === 'passenger' && d.porthole !== false) {
      const pw = (xb - xa) * 0.26;
      const ph = Math.abs(bot - top) * 0.16;
      const cx = (xa + xb) / 2;
      const cy = top + Math.abs(bot - top) * 0.3;
      g.fillStyle = '#1a2229';
      roundRect(g, cx - pw / 2, cy - ph / 2, pw, ph, pw * 0.45, ph * 0.45);
      g.fill();
    }
    if (d.kind !== 'cargo') {
      // The handle recess, towards the aft edge at half height.
      g.fillStyle = dark ? 'rgba(230,236,240,0.35)' : 'rgba(28,36,44,0.45)';
      const hx = xa + (xb - xa) * 0.72;
      const hy = top + Math.abs(bot - top) * 0.55;
      g.fillRect(hx - (xb - xa) * 0.09, hy - 1.5, (xb - xa) * 0.18, 3);
    }
  }
  // The nose gear bay, shut: the pair of forward doors as a seam round the
  // pair and one down the middle. The belly centreline is the texture's
  // bottom row on both sides, so one rectangle paints both doors. (The main
  // bays are under the wing-body fairing, which samples one plain row of
  // this texture along its whole length, so nothing is painted there.)
  for (const bay of p.bays || []) {
    const xa = U(bay.z0);
    const xb = U(bay.z1);
    const rows = Math.max(3, (bay.halfWidth / (Math.PI * bay.w)) * H);
    g.strokeStyle = dark ? 'rgba(230,236,240,0.3)' : 'rgba(28,36,44,0.5)';
    g.lineWidth = Math.max(1.4, W / 1400);
    g.strokeRect(xa, H - rows, xb - xa, rows - 1.5);
    g.beginPath();
    g.moveTo(xa, H - 1.5);
    g.lineTo(xb, H - 1.5);
    g.stroke();
  }
  if (p.extra) p.extra(g, W, H, U, V);
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  t.name = key;
  textures.set(key, t);
  return t;
}

function roundRect(g, x, y, w, h, rx, ry) {
  rx = Math.max(0, Math.min(rx, Math.abs(w) / 2));
  ry = Math.max(0, Math.min(ry, Math.abs(h) / 2));
  g.beginPath();
  g.moveTo(x + rx, y);
  g.lineTo(x + w - rx, y);
  g.quadraticCurveTo(x + w, y, x + w, y + ry);
  g.lineTo(x + w, y + h - ry);
  g.quadraticCurveTo(x + w, y + h, x + w - rx, y + h);
  g.lineTo(x + rx, y + h);
  g.quadraticCurveTo(x, y + h, x, y + h - ry);
  g.lineTo(x, y + ry);
  g.quadraticCurveTo(x, y, x + rx, y);
  g.closePath();
}

/** The cabin window: a rounded pane, its rubber surround, a sky reflection. Alpha-tested. */
let windowTex = null;
function cabinWindowTexture() {
  if (windowTex) return windowTex;
  const W = 64;
  const H = 96;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d');
  g.clearRect(0, 0, W, H);
  // Surround.
  g.fillStyle = '#4c555d';
  roundRect(g, 2, 2, W - 4, H - 4, (W - 4) * 0.46, (H - 4) * 0.36);
  g.fill();
  // Pane: dark, with a sky-coloured sheen across the top.
  const grad = g.createLinearGradient(0, 6, 0, H - 6);
  grad.addColorStop(0, '#5d7486');
  grad.addColorStop(0.35, '#22303a');
  grad.addColorStop(1, '#10161b');
  g.fillStyle = grad;
  roundRect(g, 7, 7, W - 14, H - 14, (W - 14) * 0.46, (H - 14) * 0.36);
  g.fill();
  windowTex = new THREE.CanvasTexture(c);
  windowTex.colorSpace = THREE.SRGBColorSpace;
  windowTex.anisotropy = 4;
  return windowTex;
}

/**
 * The airliner material set, owned by the model (disposed with it). The
 * textures are the shared cache's.
 *
 * DECALS NEVER Z-FIGHT. Everything laid on the skin — windscreen frames,
 * glass, wipers, cabin windows — sits a few centimetres out along the
 * normal, but a few centimetres is less than the depth buffer can tell apart
 * once another airliner is 300 m away (near plane 0.4 m, 24 bits: about a
 * centimetre of resolution at 300 m, four at 600), and a window that wins
 * the depth test on one frame and loses it on the next is a flickering
 * fuselage — the strobing the owner saw on the traffic. So every decal
 * material also carries a polygon offset, which is applied in depth units
 * and so holds at any distance.
 */
export const DECAL = { polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 };

export function airlinerMaterials(model, { livery, base, interior = '#59626b' } = {}) {
  const own = (m) => model.userData.ownMaterial(m);
  const env = helicopterReflectionEnvironment();
  const dark = luma(css(base, '#f4f6f8')) < 0.35;
  return {
    skin: own(new THREE.MeshPhysicalMaterial({
      name: 'Airliner_livery', map: livery, color: 0xffffff, roughness: dark ? 0.5 : 0.38, metalness: dark ? 0.2 : 0.1,
      clearcoat: 0.35, clearcoatRoughness: 0.22, envMap: env, envMapIntensity: 0.6,
    })),
    nacelle: own(new THREE.MeshPhysicalMaterial({
      name: 'Airliner_nacelle', color: new THREE.Color(css(base, '#f4f6f8')), roughness: 0.34, metalness: 0.12,
      clearcoat: 0.4, clearcoatRoughness: 0.2, envMap: env, envMapIntensity: 0.6,
    })),
    lip: own(new THREE.MeshStandardMaterial({ name: 'Airliner_intake_lip', color: 0xc9ced3, metalness: 0.92, roughness: 0.22, envMap: env, envMapIntensity: 1.1 })),
    duct: own(new THREE.MeshStandardMaterial({ name: 'Airliner_duct', color: 0x2a3036, metalness: 0.35, roughness: 0.6 })),
    core: own(new THREE.MeshStandardMaterial({ name: 'Airliner_core_cowl', color: 0x8d949a, metalness: 0.7, roughness: 0.36, envMap: env, envMapIntensity: 0.7 })),
    frame: own(new THREE.MeshStandardMaterial({ name: 'Airliner_windscreen_frame', color: 0x0b0e11, metalness: 0.2, roughness: 0.42, envMap: env, envMapIntensity: 0.35, ...DECAL })),
    glass: own(new THREE.MeshPhysicalMaterial({
      name: 'Airliner_flight_deck_glass', color: 0x0e161c, metalness: 0.05, roughness: 0.05, clearcoat: 1, clearcoatRoughness: 0.03,
      reflectivity: 0.75, envMap: env, envMapIntensity: 1.65, ...DECAL,
    })),
    wiper: own(new THREE.MeshStandardMaterial({ name: 'Airliner_wiper', color: 0x15191d, metalness: 0.5, roughness: 0.5, ...DECAL })),
    window: own(new THREE.MeshStandardMaterial({
      name: 'Airliner_cabin_window', map: cabinWindowTexture(), alphaTest: 0.5, roughness: 0.12, metalness: 0.2,
      envMap: env, envMapIntensity: 0.9, ...DECAL,
    })),
    // Bare metal for the undercarriage: oleos, links, axles, hubs.
    gear: own(new THREE.MeshStandardMaterial({ name: 'Airliner_gear_metal', color: 0xb9bec4, metalness: 0.85, roughness: 0.32, envMap: env, envMapIntensity: 0.8 })),
    hub: own(new THREE.MeshStandardMaterial({ name: 'Airliner_wheel_hub', color: 0x9aa0a6, metalness: 0.7, roughness: 0.45 })),
    // The wheels: tyre and hub in one lathe, coloured per vertex (see airliners.js tyreGeometry).
    tyre: own(new THREE.MeshStandardMaterial({ name: 'Airliner_tyre', vertexColors: true, color: 0xffffff, roughness: 0.72, metalness: 0.25 })),
    interior: own(new THREE.MeshStandardMaterial({ name: 'Airliner_door_lining', color: new THREE.Color(interior), metalness: 0.05, roughness: 0.8, side: THREE.DoubleSide })),
    // The dark doorway shown behind an open door lies 3 mm on the skin: a decal too.
    opening: own(new THREE.MeshStandardMaterial({ name: 'Airliner_door_opening', color: 0x1d2329, metalness: 0, roughness: 0.95, ...DECAL })),
  };
}

/* ------------------------------------------------------------------ *
 * The fuselage
 * ------------------------------------------------------------------ */

/**
 * Loft the fuselage and hand it to the pack's three sections.
 *
 * def = {
 *   stations   hull stations (see civil-kit hull), nose first
 *   radial     quads per half-side
 *   rings      extra ring stations
 *   cuts       [noseEnd, tailStart]: where the nose, cabin and tail pieces meet
 *   along      [[z, u], ...] knots for the texture's along coordinate
 * }
 */
export function loftFuselage(def, { vMap = null, closeTail = true } = {}) {
  const h = hull({
    stations: def.stations,
    radial: def.radial || 16,
    maxStep: def.maxStep || 8,
    rings: [...(def.rings || []), ...(def.cuts || [])],
    closeTail,
  });
  remapUV(h.geometry, def.along, vMap);
  return h;
}

/**
 * Put a lofted skin into the pack's three sections, cut at def.cuts, in
 * place of the pack's own three cylinders (and the registration it laid on
 * the last one).
 */
export function placeFuselage(ctx, h, cuts, material, names = ['Nose skin', 'Cabin fuselage skin', 'Tail cone skin']) {
  const drop = (part, list) => {
    if (!part) return;
    for (const c of [...part.children]) if (list.includes(c.name)) c.removeFromParent();
  };
  drop(ctx.parts.nose, ['Tapered nose']);
  drop(ctx.parts.fuselage, ['Shaped cabin fuselage']);
  drop(ctx.parts.tail, ['Tapered aft fuselage', 'Airframe registration']);
  const pieces = splitByZ(h.geometry, cuts);
  const parents = [ctx.parts.nose, ctx.parts.fuselage, ctx.parts.tail];
  const out = [];
  pieces.forEach((g, i) => {
    if (g) out.push(meshOf(ctx, names[i], g, material, parents[i]));
  });
  return out;
}

/** u = along(z), v kept (belly 0 to roof 1). */
export function meshOf(ctx, name, geo, mat, parent) {
  const m = new THREE.Mesh(ctx.model.userData.ownGeometry(geo), mat);
  m.name = name;
  m.castShadow = !mat.transparent;
  m.receiveShadow = true;
  parent.add(m);
  return m;
}

/* ------------------------------------------------------------------ *
 * Cabin windows
 * ------------------------------------------------------------------ */

/**
 * Window rows as instanced meshes of alpha-tested quads, each pane turned to
 * the skin's own normal: one draw call for every window of a piece.
 *
 * rows: [{ h: hull, y, z0, z1, pitch | count, w, ht, skip: [[za, zb]] }]
 *
 * `parent` is the node the panes hang from, or a function of the window's z
 * returning one. The fuselage is three breakaway pieces (placeFuselage), and
 * a pane must belong to the piece of skin it sits on: when the tail came off
 * in a crash, every window of the aeroplane stayed with the cabin piece and a
 * dashed row of dark panes hung in the air behind the broken end. With a
 * function, the panes are grouped by the piece it names — one instanced mesh
 * per piece, each named 'Cabin window rows', so the crash's clone of a piece
 * (common.js strike) carries its own windows away with it.
 *
 * `lift` is how far out along the normal each pane sits. The hull is drawn
 * as flat quads between its rings — 36 round a 747's 6.6 m tube — and the
 * skin between two vertices sags 1.1 cm below the surface the panes follow,
 * so a pane 1 cm out had its middle buried in the facet and read as a smear;
 * 3 cm clears every facet of every type here (the Meridian's are smaller).
 */
export function windowRows(ctx, rows, material, parent, { lift = 0.03 } = {}) {
  const byParent = new Map(); // piece -> its panes' matrices, in row order
  const parentOf = typeof parent === 'function' ? parent : () => parent;
  const P = new THREE.Vector3();
  const N = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  const look = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const tgt = new THREE.Vector3();
  let total = 0;
  for (const row of rows) {
    const count = row.count ?? Math.floor((row.z1 - row.z0) / row.pitch) + 1;
    for (let i = 0; i < count; i++) {
      const z = count === 1 ? (row.z0 + row.z1) / 2 : mix(row.z0, row.z1, i / (count - 1));
      if ((row.skip || []).some(([a, b]) => z > a && z < b)) continue;
      const piece = parentOf(z);
      if (!piece) continue;
      let mats = byParent.get(piece);
      if (!mats) byParent.set(piece, (mats = []));
      const h = row.h;
      const s = h.angleAt(z, row.y);
      for (const side of [-1, 1]) {
        h.point(z, side * s, P);
        h.normal(z, side * s, N);
        P.addScaledVector(N, lift);
        tgt.copy(P).add(N);
        look.lookAt(tgt, P, up);
        q.setFromRotationMatrix(look);
        mats.push(new THREE.Matrix4().compose(P.clone(), q.clone(), new THREE.Vector3(row.w, row.ht, 1)));
        total++;
      }
    }
  }
  const meshes = [];
  for (const [piece, mats] of byParent) {
    const mesh = addInstanced(ctx.model, piece, 'Cabin window rows', new THREE.PlaneGeometry(1, 1), material, mats);
    mesh.castShadow = false;
    mesh.computeBoundingSphere();
    meshes.push(mesh);
  }
  // `mesh` is the fullest piece's draw, for callers that only ever had one.
  const mesh = meshes.slice().sort((a, b) => b.count - a.count)[0] || null;
  return { mesh, meshes, count: total };
}

/* ------------------------------------------------------------------ *
 * Turbofans
 * ------------------------------------------------------------------ */

/**
 * A high-bypass turbofan in place of the pack's generic jet pod: an intake
 * lip with a polished leading edge, the fan cowl at its fattest a quarter of
 * the way back, the fan nozzle, then the grey core cowl stepping down to the
 * core nozzle and the exhaust plug. The pack's fan rotor and spinner stay
 * (they spin with rpm) and are moved onto the new fan face.
 *
 * e = { x, y, z, radius, length }, centred like the pack's engines.
 */
export function turbofan(ctx, group, e, mats, { segments = 18 } = {}) {
  const R = e.radius;
  const L = e.length;
  const zf = e.z - L / 2;
  // The pack's pod: its loft, lip, fan disc, throat and pylon go.
  for (const c of [...group.children]) {
    if (['Lofted aircraft skin', 'Polished intake lip', 'Recessed front fan', 'Exhaust throat', 'Engine support pylon', 'Core cowl', 'Exhaust plug'].includes(c.name)) c.removeFromParent();
  }
  const at = (g) => {
    g.translate(e.x, e.y, 0);
    return g;
  };
  /*
   * Every profile below is a path along the surface with the solid on its
   * right, so turned() faces each part the right way without flipping:
   * forward along the inside of the inlet, round the lip, back down the
   * outside of the cowl; aft along the core.
   */
  const fanZ = zf + 0.2 * L;
  const p = (r, f) => [r * R, zf + f * L];
  const T = (pts, seg = segments) => at(turned(pts, seg, { vBand: 0.5 }));
  const small = Math.max(10, segments - 6);
  meshOf(ctx, 'Inlet duct', T([[0.8 * R, fanZ], p(0.83, 0.06)]), mats.duct, group);
  meshOf(ctx, 'Intake lip', T([p(0.83, 0.06), p(0.875, 0.01), p(0.93, 0.003), p(0.975, 0.04)]), mats.lip, group);
  meshOf(ctx, 'Fan cowl', T([p(0.975, 0.04), p(1.0, 0.17), p(0.975, 0.42), p(0.865, 0.7)]), mats.nacelle, group);
  const face = new THREE.CircleGeometry(0.8 * R, segments);
  face.rotateY(Math.PI);
  face.translate(0, 0, fanZ + 0.02);
  meshOf(ctx, 'Fan face', at(face), mats.duct, group);
  // The fan nozzle's inside and the dark annulus of the bypass exit.
  meshOf(ctx, 'Bypass exit', T([p(0.865, 0.7), p(0.6, 0.655)]), mats.duct, group);
  meshOf(ctx, 'Core cowl', T([p(0.6, 0.64), p(0.565, 0.8), p(0.42, 0.98)]), mats.core, group);
  meshOf(ctx, 'Core nozzle', T([p(0.42, 0.98), p(0.3, 0.95)], small), mats.duct, group);
  meshOf(ctx, 'Exhaust plug', T([p(0.3, 0.93), p(0.24, 1.07), p(0.02, 1.17)], small), mats.core, group);
  // The pack's fan rotor, onto the new fan face; a new spinner in front of it.
  const rotor = group.children.find((c) => c.name === 'Spinning jet fan');
  if (rotor) {
    rotor.position.set(e.x, e.y, fanZ - 0.01);
    rotor.scale.setScalar(1.25);
  }
  const old = group.children.find((c) => c.name === 'Fan spinner');
  if (old) old.removeFromParent();
  const cone = T([[0.001, fanZ - 0.26 * R], [0.13 * R, fanZ - 0.16 * R], [0.22 * R, fanZ + 0.02]], 12);
  const sp = meshOf(ctx, 'Fan spinner', cone, mats.core, group);
  sp.castShadow = false;
  return { fanZ };
}

/* ------------------------------------------------------------------ *
 * Registration
 * ------------------------------------------------------------------ */

/**
 * The registration, as a decal laid on the hull on both sides, reading
 * left-to-right from either side. In place of the pack's, which it laid on
 * its own cylinder and which is gone with it.
 *
 * Also the titling line a scheme may carry ("UNITED STATES OF AMERICA" on
 * Air Force One): the same decal, wider and flatter (`height`, by default a
 * quarter of the width, the registration texture's own shape), under its
 * own `name`.
 */
export function registration(ctx, h, { text, z, y, width, height, colour, texture, name = 'Airframe registration' }, parent) {
  if (!text || !texture) return;
  const mat = ctx.model.userData.ownMaterial(new THREE.MeshBasicMaterial({
    map: texture, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, toneMapped: true,
  }));
  height = height || width * 0.25;
  /*
   * Out of the facets, like every other decal (windowRows): 3 cm off the
   * surface, and six rows across. This was 8 mm and one row, which made
   * the patch a flat chord between its top and bottom edges — 1.6 cm
   * inside the surface at its middle for the 747's number on the cone,
   * 3 cm for the A320's, 5 cm for a 1.2 m titling band on the tube — under
   * the hull's own facets (1.3 cm deep on the 747), so no registration had
   * ever actually shown, and the title was two thin lines. Six rows over a
   * band this tall is a step of three or four degrees, a sag under a
   * millimetre.
   */
  for (const side of [1, -1]) {
    const s0 = h.angleAt(z, y + height / 2);
    const s1 = h.angleAt(z, y - height / 2);
    const quad = [[z - width / 2, s0], [z + width / 2, s0], [z + width / 2, s1], [z - width / 2, s1]];
    const g = skinPatch(h, quad, side, 0.03, 8, 6, null);
    // u along the patch from its quad corner a to b (nose to tail), v top to bottom.
    const uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) {
      const u = uv.getX(i);
      const v = uv.getY(i);
      uv.setXY(i, side > 0 ? 1 - u : u, 1 - v);
    }
    const m = meshOf(ctx, name, g, mat, parent);
    m.castShadow = false;
  }
}

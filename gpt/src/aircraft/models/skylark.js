/**
 * The Skylark's own details: braced struts, wing-root fairings, rounded
 * wingtips, and the four-seat "greenhouse" cabin roof with its mullioned
 * glazing.
 *
 * model.js draws every aeroplane in the game from one lofted body and one
 * aerofoil wing, which is right — but the trainer is the aircraft the class
 * actually flies, and it was getting the generic parts: two straight
 * cylinders for struts that did not meet the wing where the wing is, square
 * wingtips, and a small blister over the back half of a cabin that is meant
 * to be a glasshouse.
 *
 * Every function here takes THREE and the already-built materials as
 * arguments rather than importing them, so this file has no imports and no
 * side effect at load. `installSkylarkDetails(ctx)` is the single call
 * model.js makes; it is a no-op for every other aeroplane.
 */
/**
 * The trainer's fuselage lathe profile, copied from model.js's own `profile`
 * array (radius, z-station pairs, before the per-aircraft bodyRadius/
 * bodyLength multiply). Needed here only so `bodyRadiusAt()` below can place
 * the wing-root fairing and the strut's fuselage end ON the skin rather than
 * guessing an x. If model.js's fuselage profile ever changes, this copy must
 * change with it — it is small on purpose so that is a two-minute diff, not
 * a refactor.
 */
const FUSELAGE_PROFILE = [
  [0.05, -2.55],
  [0.3, -2.42],
  [0.5, -2.15],
  [0.62, -1.7],
  [0.7, -1.1],
  [0.76, -0.3],
  [0.78, 0.45],
  [0.75, 1.15],
  [0.66, 1.95],
  [0.52, 2.7],
  [0.34, 3.35],
  [0.18, 3.85],
  [0.05, 3.95],
];

/** Linear interpolation — duplicated here (it is one line) to avoid a core/noise.js import. */
function lerp(a, b, t) {
  return a + (b - a) * t;
}

/** Fuselage half-width at a Z station, in this aircraft's own scale. */
function bodyRadiusAt(z, S) {
  const pts = FUSELAGE_PROFILE.map(([r, pz]) => [r * S.bodyRadius, pz * S.bodyLength]);
  if (z <= pts[0][1]) return pts[0][0];
  for (let i = 1; i < pts.length; i++) {
    if (z <= pts[i][1]) {
      const a = pts[i - 1];
      const b = pts[i];
      const t = (z - a[1]) / (b[1] - a[1] || 1);
      return lerp(a[0], b[0], t);
    }
  }
  return pts[pts.length - 1][0];
}

/** Wing chord at a span fraction 0..1 — must match model.js's own `chordAt`. */
function defaultChordAt(f, S) {
  return lerp(S.rootChord, S.tipChord, Math.pow(f, 1.25));
}

/** Wing sweep offset at a span fraction 0..1 — must match model.js's own `sweepAt`. */
function defaultSweepAt(f, S) {
  return S.sweep * Math.pow(f, 1.1);
}

/**
 * The wing's own aerofoil lower-surface offset (camber line minus
 * half-thickness) at a chordwise fraction 0..1, in units of chord — the same
 * curve `aerofoil()` in model.js draws the skin from. `thickness` is 0.135
 * for this wing (it is not `fast`: `S.sweep` is 0.28, well under the 1.4
 * cutoff model.js uses to pick the thin/fast section).
 */
function aerofoilLowerOffset(cx, thickness = 0.135, camber = 0.025) {
  const yt =
    5 *
    thickness *
    (0.2969 * Math.sqrt(cx) - 0.126 * cx - 0.3516 * cx * cx + 0.2843 * cx ** 3 - 0.1036 * cx ** 4);
  const yc = cx < 0.4 ? (camber / 0.16) * (2 * 0.4 * cx - cx * cx) : (camber / 0.36) * (1 - 2 * 0.4 + 2 * 0.4 * cx - cx * cx);
  return yc - yt;
}

/**
 * Fixes the wing struts so they actually reach the wing.
 *
 * ctx: { THREE, root: THREE.Group, S: shape, strutMat: THREE.Material,
 *        chordAt?, sweepAt? }
 * `chordAt`/`sweepAt` default to the formulas above but can be passed in as
 * model.js's own closures instead, if the lead prefers zero duplication over
 * zero coupling.
 *
 * Replaces model.js's existing `if (S.struts) …` block (see install notes).
 * Safe as a straight replacement: `struts: true` is set nowhere else in
 * types.js, so this only ever draws for the Skylark today — but it is
 * written from `S` rather than from this aircraft's numbers, so any future
 * strut-braced type gets a strut that actually touches its wing too.
 */
export function buildSkylarkStruts(ctx) {
  const { THREE, root, S, strutMat } = ctx;
  const chordAt = ctx.chordAt || ((f) => defaultChordAt(f, S));
  const sweepAt = ctx.sweepAt || ((f) => defaultSweepAt(f, S));
  const fast = S.sweep > 1.4;
  const thickness = fast ? 0.075 : 0.135;
  const halfSpan = S.halfSpan;
  const fStrut = 0.43; // span fraction the lift strut reaches the wing

  let built = 0;
  for (const side of [-1, 1]) {
    const chordStrut = chordAt(fStrut);
    const sweepStrut = sweepAt(fStrut);
    const bx = side * (S.wingRootX + fStrut * halfSpan);
    // Two fuselage attach points (fore and aft), each running to the wing's
    // own lower skin at the matching chordwise station — a forward strut and
    // an aft one, the way a real strut-braced single fans out for stiffness.
    for (const cx of [0.14, 0.72]) {
      const az = -0.55 * S.bodyLength + cx * 0.9 * S.bodyLength;
      const ax = side * bodyRadiusAt(az, S) * 0.94;
      const a = new THREE.Vector3(ax, -0.34 * S.bodyRadius, az);
      const bz = S.wingZ + sweepStrut + cx * chordStrut;
      const by = S.wingY + S.dihedral * fStrut + aerofoilLowerOffset(cx, thickness) * chordStrut;
      const b = new THREE.Vector3(bx, by, bz);
      const dir = new THREE.Vector3().subVectors(b, a);
      const strut = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.05, dir.length(), 8), strutMat);
      strut.position.copy(a).addScaledVector(dir, 0.5);
      strut.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
      strut.castShadow = true;
      root.add(strut);
      built++;
    }
  }
  return built; // 4, same mesh count as the code being replaced
}

/**
 * Wing-root fairing (both sides) and rounded wingtips (both sides).
 *
 * ctx: { THREE, root, S, bodyMat, chordAt?, sweepAt? }
 * Additive — insert after `root.add(wings);` in model.js, gated on
 * `type.id === 'skylark'` so no other aeroplane's silhouette changes.
 */
export function buildSkylarkWingFairings(ctx) {
  const { THREE, root, S, bodyMat } = ctx;
  const sweepAt = ctx.sweepAt || ((f) => defaultSweepAt(f, S));
  const fast = S.sweep > 1.4;
  const halfSpan = S.halfSpan;

  let built = 0;
  for (const side of [-1, 1]) {
    // Fairing: fills the hard step where a high strut wing meets the
    // fuselage side — one of the three or four details a Cessna-shape is
    // read by. Centred to overlap both the wing root and the fuselage top so
    // the two surfaces blend rather than leaving a visible seam.
    const fillet = new THREE.Mesh(new THREE.SphereGeometry(0.24, 10, 8), bodyMat);
    fillet.scale.set(1.35, 0.5, 2.5);
    fillet.position.set(side * (S.wingRootX + 0.02), S.wingY - 0.1, S.wingZ + S.rootChord * 0.4);
    fillet.castShadow = true;
    root.add(fillet);
    built++;

    // Tip: the loft ends in a flat vertical cap, which reads as a clipped
    // wing at any distance. A small cap the width of the local aerofoil
    // thickness rounds it off without changing the planform underneath it.
    const tip = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 8), bodyMat);
    const tc = S.tipChord;
    tip.scale.set(0.05 * tc, (fast ? 0.075 : 0.135) * tc * 0.55, tc * 0.5);
    tip.position.set(side * (S.wingRootX + halfSpan), S.wingY + S.dihedral, S.wingZ + sweepAt(1) + tc * 0.46);
    tip.castShadow = true;
    root.add(tip);
    built++;
  }
  return built; // 4
}

/**
 * The big glasshouse roof. Replaces the small aft blister the shared 'cabin'
 * canopy draws — but only for a new `canopy: 'greenhouse'` value, so
 * anything still declaring `canopy: 'cabin'` (the Courier) is untouched.
 *
 * ctx: { THREE, root, bodyMat }
 * Install as a new `else if (S.canopy === 'greenhouse')` branch alongside
 * model.js's existing `if (S.canopy === 'cabin') { … }` roof block.
 */
export function buildSkylarkGreenhouseRoof(ctx) {
  const { THREE, root, bodyMat } = ctx;
  const roof = new THREE.Mesh(new THREE.SphereGeometry(0.95, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.5), bodyMat);
  // Kept clear of the eye point (z = -0.28), same reason as the 'cabin'
  // blister: a roof that reaches forward of the pilot's head paints over the
  // cockpit view. Wider (x/z scale) and taller aft reach (1.85 vs 1.15) than
  // 'cabin' so the roof runs the length of a real four-seat cabin instead of
  // sitting only over the back half of it.
  roof.scale.set(1, 0.48, 1.85);
  roof.position.set(0, 0.3, 0.32);
  roof.castShadow = true;
  root.add(roof);
  return 1;
}

/**
 * Four panes a side, split by thin painted mullions, in place of the two
 * undivided panes the 'cabin' canopy draws. Also gated on `canopy ===
 * 'greenhouse'`, alongside model.js's existing side-window if/else chain.
 *
 * ctx: { THREE, root, glassMat, matteMat }
 */
export function buildSkylarkGreenhouseGlazing(ctx) {
  const { THREE, root, glassMat, matteMat } = ctx;
  const panes = [
    { z: -0.66, w: 0.62, h: 0.56 },
    { z: -0.02, w: 0.66, h: 0.58 },
    { z: 0.62, w: 0.64, h: 0.5 },
    { z: 1.2, w: 0.5, h: 0.4 },
  ];
  let built = 0;
  for (const side of [-1, 1]) {
    for (const p of panes) {
      const pane = new THREE.Mesh(new THREE.PlaneGeometry(p.w, p.h), glassMat);
      pane.position.set(side * 0.78, 0.3, p.z);
      pane.rotation.y = side * Math.PI * 0.5;
      root.add(pane);
      built++;
    }
    for (let i = 0; i < panes.length - 1; i++) {
      const z = (panes[i].z + panes[i + 1].z) / 2;
      const mullion = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.6, 0.05), matteMat);
      mullion.position.set(side * 0.79, 0.3, z);
      root.add(mullion);
      built++;
    }
  }
  return built; // 14: two sides x (4 panes + 3 mullions)
}

/**
 * Everything in this file, in one call. `type` is optional; if given, the
 * whole thing is a no-op for anything but the Skylark, so it is safe to call
 * unconditionally from model.js if that is more convenient than gating at
 * each call site individually.
 *
 * ctx: { THREE, root, S, type?, bodyMat, glassMat, matteMat, strutMat,
 *        chordAt?, sweepAt? }
 */
export function installSkylarkDetails(ctx) {
  if (ctx.type && ctx.type.id !== 'skylark') return null;
  const struts = ctx.S.struts ? buildSkylarkStruts(ctx) : 0;
  const fairings = buildSkylarkWingFairings(ctx);
  const roof = buildSkylarkGreenhouseRoof(ctx);
  const glazing = buildSkylarkGreenhouseGlazing(ctx);
  return { struts, fairings, roof, glazing, totalMeshes: struts + fairings + roof + glazing };
}

/**
 * The one-field change types.js needs — spread this over the Skylark's
 * existing shape, not over TRAINER_SHAPE itself (Courier spreads
 * TRAINER_SHAPE too and must keep `canopy: 'cabin'`).
 */
export const SKYLARK_SHAPE_PATCH = { canopy: 'greenhouse' };

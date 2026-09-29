/**
 * Tempest WR-4 — a twin-turboprop weather-research aeroplane: high wing,
 * slab-sided body, gear in sponsons, and the instruments that say
 * "research" — a radome, a long air-data boom and cloud-probe canisters.
 *
 * What was wrong with it (rendered from outside, before this file):
 *
 *  - The nacelles were plain cylinders hung at the wing's own height, so
 *    the wing ran straight through the middle of each one, and they ended at
 *    the trailing edge in a flat disc.
 *  - The propellers were 5.1 m across on a 15 m aeroplane, two plain boxes
 *    per disc. Turboprops of this size turn four blades of about 4.4 m.
 *  - The body was the round lathe the blurb calls "slab-sided", with a glass
 *    shed on top and a sawtooth down each side where it was cut in.
 *  - "Weather radar nose" was a black ball stuck on the front of the nose.
 *  - Flaps and ailerons were slabs lying on the wing, and the mains hung off
 *    the fuselage on bare legs with nothing to retract into.
 *
 * Gear contact points, eye, scale, wing tips and strike points unchanged;
 * the propeller radius and nacelle size are drawing-only shape numbers.
 */
import * as THREE from '../../vendor/three.module.js';
import { hull, wing, roundNose, tubePath, turned } from './civil-kit.js';
import { tailGroup, oleoLeg, windowRow, tailBumper, seamOnSkin } from './civil-details.js';

const Z_AXIS = new THREE.Vector3(0, 0, 1);

export function buildTempest(b) {
  const { S, m } = b;
  const tipX = S.wingRootX + S.halfSpan;

  /* ---------------- Fuselage ---------------- */
  /*
   * Radome first, as its own piece so it can be a different colour; the
   * body starts just inside where it ends.
   *
   * The two used to meet at the same section, and the joint was a sawtooth
   * of blue through grey: the radome is 8 quads a side and the body 13, and
   * a facet of the coarser one lies up to 1 cm inside the true surface
   * (0.5 x (1 - cos 11.25 deg)) where the finer one's vertices are on it.
   * The radome's back edge is 3% fuller now, so the body stays under it and
   * the joint reads as the lip a real radome has.
   */
  const noseTo = { w: 0.515, top: 0.371, bot: -0.577, yc: -0.1, nT: 2.3, nB: 2.5 };
  const radome = hull({
    stations: [...roundNose(-3.5, 0.95, noseTo, { y: -0.14 }, 5), { z: -2.5, w: 0.525, top: 0.381, bot: -0.582, yc: -0.1, nT: 2.35, nB: 2.55 }],
    radial: 8,
    maxStep: 0.4,
  });
  b.addHull(radome, m.grey, 'radome');
  const stations = [
    { z: -2.51, w: 0.51, top: 0.37, bot: -0.565, yc: -0.1, nT: 2.35, nB: 2.55 },
    { z: -2.1, w: 0.56, top: 0.42, bot: -0.6, yc: -0.08, nT: 2.7, nB: 2.9 },
    { z: -1.72, w: 0.6, top: 0.46, bot: -0.62, yc: -0.05, nT: 3.0, nB: 3.2 },
    { z: -1.3, w: 0.62, top: 0.63, bot: -0.63, yc: -0.02, nT: 3.2, nB: 3.4 },
    { z: -0.9, w: 0.63, top: 0.66, bot: -0.63, yc: 0, nT: 3.3, nB: 3.5 },
    /*
     * The cabin ran to 2.3 and the cone to 6.2: 15.2 m of body under 26 m of
     * wing, 0.71 as long as it was wide, where a high-wing twin of that span
     * (ATR 42, Dash 8-100) is 0.85-0.9 — from above it was a wing with a
     * short pod under it. The belly had 0.3 to spare over the tail-strike
     * line, y = -1.35 + 0.2837 (z - 0.8), from 3.1 to 4.9; the cabin now
     * runs to 2.9 and every cone station is 0.07-0.1 above the line, which
     * takes the tail to 6.85 and the fin and tailplane with it (types.js
     * finZ, hZ).
     */
    { z: 2.9, w: 0.63, top: 0.66, bot: -0.63, yc: 0, nT: 3.3, nB: 3.5 },
    { z: 3.6, w: 0.57, top: 0.64, bot: -0.46, yc: 0.07, nT: 3.0, nB: 3.0 },
    { z: 4.5, w: 0.44, top: 0.59, bot: -0.21, yc: 0.18, nT: 2.7, nB: 2.6 },
    { z: 5.4, w: 0.3, top: 0.55, bot: 0.04, yc: 0.28, nT: 2.4, nB: 2.3 },
    { z: 6.3, w: 0.16, top: 0.51, bot: 0.28, yc: 0.38, nT: 2.2, nB: 2.2 },
    { z: 6.85, w: 0.06, top: 0.49, bot: 0.42, yc: 0.455, nT: 2.0, nB: 2.0 },
  ];
  const h = hull({
    stations,
    radial: 9,
    // The cabin is one constant section from -0.9 to 2.9: rings there bend
    // nothing, and at 0.42 apart they were 400 of the triangles over budget.
    maxStep: 0.8,
    lines: { ctr: 0.05, fdTop: 0.52, ws: 1.0, fdBot: 1.22 },
    windows: [
      { z0: -1.7, z1: -1.32, from: 'ctr', to: 'ws' },
      { z0: -1.26, z1: -0.74, from: 'fdTop', to: 'fdBot' },
    ],
  });
  b.addHull(h);
  // Big square cabin windows, the survey aeroplane's trademark.
  windowRow(b, h, { z0: -0.25, z1: 2.25, pitch: 0.5, y: 0.26, w: 0.3, h: 0.3, r: 0.07 });
  // Cargo door outline, left side aft. Its sill was at y -0.5 where the
  // belly has already swept up to -0.36, so the outline's aft corner hung
  // below the aeroplane; it now sits between the last window and the sweep.
  {
    const corners = [[-0.28, -0.3], [-0.28, 0.42], [0.28, 0.42], [0.28, -0.3], [-0.28, -0.3]];
    b.put(seamOnSkin(h, 2.78, -1, corners, { width: 0.026 }), m.grey);
  }

  /* ---------------- Sponsons: the main gear lives in these ---------------- */
  for (const side of [-1, 1]) {
    const sp = hull({
      stations: [
        ...roundNose(-0.15, 0.55, { w: 0.34, top: -0.18, bot: -0.72, yc: -0.48, nT: 2.4, nB: 2.6 }, { y: -0.48 }, 3),
        { z: 1.2, w: 0.36, top: -0.16, bot: -0.72, yc: -0.48, nT: 2.4, nB: 2.6 },
        { z: 2.1, w: 0.1, top: -0.3, bot: -0.6, yc: -0.48, nT: 2.2, nB: 2.2 },
      ],
      radial: 5,
      uvBand: 0.2,
      maxStep: 0.9,
    });
    b.put(sp.geometry, m.body, { p: [side * 0.82, 0, 0] });
  }

  /* ---------------- Wing ---------------- */
  const le0 = S.wingZ;
  const f = (s) => Math.max(0, (s - S.wingRootX) / S.halfSpan);
  const yAt = (s) => S.wingY + S.dihedral * f(s);
  const leAt = (s) => le0 + S.sweep * f(s);
  const wingStations = [
    { s: 0, chord: S.rootChord, le: le0, y: S.wingY },
    { s: S.wingRootX, chord: S.rootChord, le: le0, y: S.wingY },
    { s: tipX, chord: S.tipChord, le: leAt(tipX), y: yAt(tipX) },
  ];
  const nx = S.power.x;
  const nr = S.power.radius;
  const cuts = [
    { name: 'flapIn', s0: S.wingRootX + 0.06, s1: nx - nr - 0.08, hinge: 0.72 },
    { name: 'flapOut', s0: nx + nr + 0.08, s1: 4.95, hinge: 0.72 },
    { name: 'aileron', s0: 5.05, s1: tipX - 0.32, hinge: 0.74 },
  ];
  for (const side of ['right', 'left']) {
    const w = wing({ frame: side, stations: wingStations, t: 0.15, m: 0.025, steps: 6, cuts, tipRound: 0.16 });
    b.put(w.fixed, m.body);
    b.addSurface('flap', w.surfaces.flapIn);
    b.addSurface('flap', w.surfaces.flapOut);
    b.addSurface(side === 'right' ? 'aileronR' : 'aileronL', w.surfaces.aileron);
  }

  /* ---------------- Nacelles and propellers ---------------- */
  /*
   * Slung under the wing, the way a high-wing twin's are: round behind the
   * spinner, a chin intake, a top line that runs into the wing's leading
   * edge, and a tail cone that ends just aft of the trailing edge.
   *
   * They were flat-topped boxes 0.73 tall and 4 units long, their tops level
   * with the wing's upper skin all the way back — from the side, a second
   * deck along the cabin roof, with the stripe painted down it. Between the
   * spars the nacelle is now inside the wing, so what shows is the part a
   * real one shows: in front of the leading edge and behind the flap.
   */
  const hubY = S.power.y ?? 0.5;
  const hubZ = S.power.z;
  const chordAt = (s) => S.rootChord + (S.tipChord - S.rootChord) * f(s);
  for (const side of [-1, 1]) {
    const x = side * nx;
    const wy = yAt(nx);
    const le = leAt(nx);
    const te = le + chordAt(nx);
    const nac = hull({
      stations: [
        { z: hubZ + 0.08, w: 0.19, top: hubY + 0.19, bot: hubY - 0.19, yc: hubY },
        { z: hubZ + 0.45, w: nr * 0.8, top: hubY + nr * 0.8, bot: hubY - nr * 0.95, yc: hubY },
        { z: hubZ + 1.0, w: nr * 0.86, top: hubY + nr * 0.92, bot: hubY - nr, yc: hubY },
        { z: le + 0.2, w: nr * 0.86, top: wy + 0.1, bot: hubY - nr * 0.95, yc: hubY + 0.04 },
        { z: le + (te - le) * 0.6, w: nr * 0.76, top: wy + 0.08, bot: hubY - nr * 0.72, yc: hubY + 0.1 },
        { z: te, w: nr * 0.48, top: wy + 0.03, bot: hubY - nr * 0.15, yc: hubY + 0.2 },
        { z: te + 0.55, w: 0.035, top: wy - 0.02, bot: wy - 0.08, yc: wy - 0.05 },
      ],
      radial: 6,
      uvBand: 0.2,
      maxStep: 0.6,
      nT: 2.1,
      nB: 2.1,
    });
    b.put(nac.geometry, m.body, { p: [x, 0, 0] });
    // Chin intake under the spinner, and an exhaust stack out of each side.
    // (A pointed end is radius 0, not 0.001: turned() caps any end with a
    // radius, and a cap on a point is 8-10 triangles nobody can see — 60 on
    // this aeroplane, which is what the thicker tyres cost.)
    b.put(turned([[0, -0.03], [0.1, 0], [0.1, 0.12]], 10, { closeEnds: true, yScale: 0.55 }), m.dark, { p: [x, hubY - nr * 0.84, hubZ + 0.36] });
    /*
     * The stacks were bent tubes, out of the side and then back along it,
     * capped at both ends: from above, a grey handle on each side of every
     * nacelle. A turboprop's stack is a short flared pipe pointing out and
     * aft, open at the end, so that is what this is — the dark disc is the
     * hole — and it costs 96 triangles on this aeroplane where they cost 120.
     */
    for (const out of [-1, 1]) {
      const dir = new THREE.Vector3(out * 0.72, 0.06, 0.69).normalize();
      const q = new THREE.Quaternion().setFromUnitVectors(Z_AXIS, dir);
      const at = [x + out * nr * 0.62, hubY + 0.02, hubZ + 1.0];
      b.put(turned([[0.068, 0], [0.086, 0.26]], 8, { yScale: 0.8 }), m.grey, { p: at, q });
      b.put(new THREE.CircleGeometry(0.08, 8).scale(1, 0.8, 1), m.dark, { p: [at[0] + dir.x * 0.255, at[1] + dir.y * 0.255, at[2] + dir.z * 0.255], q });
    }
    b.addProp({ at: [x, hubY, hubZ], radius: S.power.drawRadius ?? S.power.propRadius, blades: 4, chord: 0.2, spinner: { r: 0.2, len: 0.42 }, dir: -side });
  }

  /* ---------------- Tail ---------------- */
  tailGroup(b, {
    fin: { base: 0.5, le: S.finZ, root: S.finRootChord, tip: S.finRootChord * 0.5, height: S.finHeight, sweep: S.finSweep, dorsal: { len: 1.2, rise: 0.18 }, hinge: 0.62, t: 0.11 },
    stab: { y: 0.42, le: S.hZ, root: S.hRootChord, tip: S.hRootChord * 0.58, span: S.hSpan, sweep: S.hRootChord * 0.28, dihedral: 0.08, hinge: 0.62, inner: 0.26, t: 0.11 },
  });
  /*
   * A tail bumper down to the physics' tail-strike point, so what the flight
   * model calls a tail strike is this touching. It was a ventral fin 0.18
   * deep; on the longer body the belly passes only 0.09 above that point, and
   * a fin rooted there came out 5 mm deep. An ATR carries a bumper there.
   */
  tailBumper(b, h, 3.95 * S.bodyLength, -0.12, 0.4);

  /* ---------------- Gear ---------------- */
  const RM = S.wheelR.main;
  const RN = S.wheelR.nose;
  for (const side of [-1, 1]) {
    const x = side * S.main.x;
    oleoLeg(b, {
      name: 'main gear',
      top: [side * 1.05, -0.6, S.main.z - 0.12],
      axle: [x, S.main.y + RM, S.main.z],
      R: RM,
      width: 0.17,
      strut: 0.055,
      fold: { axis: [1, 0, 0], angle: -1.45 },
    });
  }
  oleoLeg(b, {
    name: 'nose gear',
    top: [0, -0.55, S.nose.z - 0.1],
    axle: [0, S.nose.y + RN, S.nose.z],
    R: RN,
    width: 0.12,
    strut: 0.045,
    steer: true,
    fold: { axis: [1, 0, 0], angle: 1.45 },
  });

  /* ---------------- Research kit ---------------- */
  // The air-data boom out of the radome, tipped in the accent colour.
  b.put(tubePath([[0, -0.14, -3.44], [0, -0.13, -4.25]], [0.03, 0.018], 6), m.metal);
  b.put(turned([[0, -0.14], [0.035, -0.02], [0.03, 0.06]], 8, { closeEnds: true }), m.accent, { p: [0, -0.13, -4.22] });
  // Cloud-probe canisters on short pylons, well out under each wing.
  for (const side of [-1, 1]) {
    const s = 5.4;
    const x = side * s;
    const under = yAt(s) - 0.09;
    const cy = under - 0.26;
    const cz = leAt(s) + 0.2;
    b.put(turned([[0, -0.45], [0.07, -0.38], [0.1, -0.2], [0.1, 0.35], [0.06, 0.45]], 8, { closeEnds: true }), m.body, { p: [x, cy, cz] });
    b.put(turned([[0, -0.47], [0.05, -0.44], [0.075, -0.36]], 8, { closeEnds: true }), m.accent, { p: [x, cy, cz] });
    b.put(tubePath([[x, cy + 0.08, cz - 0.05], [x, under + 0.06, cz + 0.05]], [0.035, 0.035], 6, { flat: 3 }), m.body);
  }
  // SATCOM dome on the crown, aft of the wing. Low and flat, as they are: at
  // 0.3 m tall with a blunt back it read, from the side, as a gun turret.
  const dome = hull({
    stations: [...roundNose(1.95, 0.35, { w: 0.16, top: 0.76, bot: 0.6, yc: 0.62 }, { y: 0.63 }, 3), { z: 2.5, w: 0.16, top: 0.755, bot: 0.6, yc: 0.62 }, { z: 2.95, w: 0.03, top: 0.67, bot: 0.61, yc: 0.63 }],
    radial: 6,
    uvBand: 0.2,
    maxStep: 0.4,
  });
  b.put(dome.geometry, m.body);
  b.put(tubePath([[0, h.botAt(0.3) + 0.02, 0.3], [0, h.botAt(0.3) - 0.22, 0.45]], [0.025, 0.01], 4), m.dark);

  /* ---------------- Lights ---------------- */
  const tipY = yAt(tipX);
  const tipZ = leAt(tipX) + S.tipChord * 0.2;
  b.lamp('navL', [-tipX - 0.02, tipY, tipZ]);
  b.lamp('navR', [tipX + 0.02, tipY, tipZ]);
  b.lamp('strobeL', [-tipX - 0.02, tipY, tipZ + 0.1]);
  b.lamp('strobeR', [tipX + 0.02, tipY, tipZ + 0.1]);
  b.lamp('tail', [0, 0.455, 6.9]);
  b.lamp('beacon', [0, 0.5 + S.finHeight + 0.03, S.finZ + S.finSweep + 0.35]);
  b.lamp('beacon2', [0, -0.66, 1.0]);
  b.lamp('landing', [-1.3, yAt(1.3) - 0.04, leAt(1.3) - 0.02]);
  return { spot: [-1.3, yAt(1.3) - 0.1, leAt(1.3) - 0.2], hull: h };
}
